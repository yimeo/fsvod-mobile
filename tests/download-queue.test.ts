import { describe, expect, it } from "vitest";

import { createQueueTask, nextRunnableTask, retryTask, upsertQueueTasks } from "../lib/download-queue";

const request = (episodeName: string, remoteUrl: string) => ({ vodId: "9", vodName: "飞鸿测试剧", sourceName: "wjm3u8", episodeName, remoteUrl });

describe("下载队列", () => {
  it("批量添加任务时跳过已有下载地址", () => {
    const first = createQueueTask(request("第01集", "https://cdn.example.com/1.m3u8"));
    const tasks = upsertQueueTasks([first], [request("第01集", "https://cdn.example.com/1.m3u8"), request("第02集", "https://cdn.example.com/2.m3u8")]);

    expect(tasks).toHaveLength(2);
    expect(tasks[1].episodeName).toBe("第02集");
  });

  it("清理已完成媒体后，同一剧集可再次加入队列", () => {
    const completed = { ...createQueueTask(request("第01集", "https://cdn.example.com/1.m3u8")), status: "completed" as const };
    const tasks = upsertQueueTasks([completed], [request("第01集", "https://cdn.example.com/1.m3u8")]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe("queued");
  });

  it("优先获取排队任务，并允许失败任务重新入队", () => {
    const first = { ...createQueueTask(request("第01集", "https://cdn.example.com/1.m3u8")), status: "failed" as const, error: "网络中断" };
    const second = createQueueTask(request("第02集", "https://cdn.example.com/2.m3u8"));
    expect(nextRunnableTask([first, second])?.episodeName).toBe("第02集");
    expect(retryTask([first, second], first.id)[0]).toMatchObject({ status: "queued", error: null });
  });
});
