"use client";

/**
 * 预览用的外壳。
 *
 * StudySession 需要外面提供「保存」这个能力。正式的背单词页面给它的是
 * 一个真正写数据库的 Server Action；这里给的是一个「什么都不写」的版本 ——
 * 所以不需要 Supabase 就能完整演示交互和复习算法。
 *
 * 为什么额外包一层，而不是直接在页面里传函数？
 * 因为页面是服务端组件，服务端组件不能把普通函数当参数传给客户端组件
 * （函数没法通过序列化边界）。所以必须有一个客户端组件来提供它。
 * 例外是可以传 Server Action，阶段 5 的正式页面就是那么做的。
 */
import { StudySession, type StudyItem } from "@/components/StudySession";

type PreviewStudySessionProps = {
  items: StudyItem[];
};

export function PreviewStudySession({ items }: PreviewStudySessionProps) {
  return (
    <StudySession
      items={items}
      onRate={async () => {
        // 预览模式：不写数据库。等一下只是为了模拟真实网络耗时，
        // 这样你能看到按钮变灰的「保存中」状态。
        await new Promise((resolve) => setTimeout(resolve, 120));
        return { ok: true };
      }}
    />
  );
}
