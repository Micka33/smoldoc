import type { CallToolResult } from "@modelcontextprotocol/server";
import type {
  CreateTaskOptions,
  Request,
  RequestId,
  Result,
  Task,
  TaskStore,
} from "@modelcontextprotocol/server";
import type { Redis as RedisClient } from "ioredis";

const TASK_PREFIX = "smoldoc:task:";
const TASK_INDEX = "smoldoc:task:index";

type StoredTaskPayload = {
  task: Task;
  requestId: RequestId;
  request: Request;
  sessionId?: string;
  result?: Result;
};

function key(taskId: string): string {
  return `${TASK_PREFIX}${taskId}`;
}

export class RedisTaskStore implements TaskStore {
  constructor(private readonly redis: RedisClient) {}

  async createTask(
    taskParams: CreateTaskOptions,
    requestId: RequestId,
    request: Request,
    sessionId?: string,
  ): Promise<Task> {
    const taskId = crypto.randomUUID().replaceAll("-", "");
    const createdAt = new Date().toISOString();
    const pollInterval = taskParams.pollInterval ?? 30_000;
    const ttl = taskParams.ttl ?? null;
    const task: Task = {
      taskId,
      status: "working",
      ttl,
      createdAt,
      lastUpdatedAt: createdAt,
      pollInterval,
    };
    const payload: StoredTaskPayload = {
      task,
      requestId,
      request,
      sessionId,
    };
    const pipeline = this.redis.pipeline();
    pipeline.set(key(taskId), JSON.stringify(payload));
    pipeline.sadd(TASK_INDEX, taskId);
    if (ttl !== null && ttl > 0) {
      pipeline.pexpire(key(taskId), ttl);
    }
    await pipeline.exec();
    return task;
  }

  private async load(taskId: string, sessionId?: string): Promise<StoredTaskPayload | null> {
    const raw = await this.redis.get(key(taskId));
    if (!raw) return null;
    const data = JSON.parse(raw) as StoredTaskPayload;
    if (
      sessionId !== undefined &&
      data.sessionId !== undefined &&
      data.sessionId !== sessionId
    ) {
      return null;
    }
    return data;
  }

  async getTask(taskId: string, sessionId?: string): Promise<Task | null> {
    const data = await this.load(taskId, sessionId);
    return data ? { ...data.task } : null;
  }

  async storeTaskResult(
    taskId: string,
    status: "completed" | "failed",
    result: Result,
    sessionId?: string,
  ): Promise<void> {
    const data = await this.load(taskId, sessionId);
    if (!data) throw new Error(`Task with ID ${taskId} not found`);
    const terminalStatus = status === "completed" ? "completed" : "failed";
    data.result = result;
    data.task = {
      ...data.task,
      status: terminalStatus,
      lastUpdatedAt: new Date().toISOString(),
    };
    await this.redis.set(key(taskId), JSON.stringify(data));
  }

  async getTaskResult(taskId: string, sessionId?: string): Promise<Result> {
    const data = await this.load(taskId, sessionId);
    if (!data) throw new Error(`Task with ID ${taskId} not found`);
    if (!data.result) throw new Error(`Task ${taskId} has no result stored`);
    return data.result;
  }

  async updateTaskStatus(
    taskId: string,
    status: Task["status"],
    statusMessage?: string,
    sessionId?: string,
  ): Promise<void> {
    const data = await this.load(taskId, sessionId);
    if (!data) throw new Error(`Task with ID ${taskId} not found`);
    data.task = {
      ...data.task,
      status,
      lastUpdatedAt: new Date().toISOString(),
      ...(statusMessage !== undefined ? { statusMessage } : {}),
    };
    await this.redis.set(key(taskId), JSON.stringify(data));
  }

  async listTasks(
    cursor?: string,
    sessionId?: string,
  ): Promise<{ tasks: Task[]; nextCursor?: string }> {
    const ids = await this.redis.smembers(TASK_INDEX);
    const filtered: string[] = [];
    for (const id of ids) {
      const data = await this.load(id, sessionId);
      if (data) filtered.push(id);
    }
    filtered.sort();
    const PAGE = 10;
    let start = 0;
    if (cursor) {
      const idx = filtered.indexOf(cursor);
      start = idx === -1 ? 0 : idx + 1;
    }
    const pageIds = filtered.slice(start, start + PAGE);
    const tasks: Task[] = [];
    for (const id of pageIds) {
      const t = await this.getTask(id, sessionId);
      if (t) tasks.push(t);
    }
    const nextCursor =
      start + PAGE < filtered.length ? pageIds.at(-1) : undefined;
    return { tasks, nextCursor };
  }
}

export function toolResultFromAnswer(payload: {
  answerMarkdown: string;
  sources: { url: string; note?: string }[];
  fromAnswerCache: boolean;
  pagesFetched: number;
  taskId: string;
}): CallToolResult {
  const structured = {
    taskId: payload.taskId,
    answerMarkdown: payload.answerMarkdown,
    sources: payload.sources,
    fromAnswerCache: payload.fromAnswerCache,
    pagesFetched: payload.pagesFetched,
  };
  return {
    content: [
      {
        type: "text",
        text: payload.answerMarkdown,
      },
    ],
    structuredContent: structured,
  };
}

export function toolResultFromError(message: string, taskId: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
    structuredContent: { taskId, error: message },
  };
}
