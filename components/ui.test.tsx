/**
 * 界面组件的自动测试。
 *
 * 【为什么需要这个】
 * 前面几轮的测试覆盖了算法、统计和数据库，但有一层一直没被验证过：
 * 「页面到底渲染出了什么」。之前只能靠请求网页、检查 HTML 里有没有某段
 * 文字。这招有个硬伤 —— 释义默认是藏起来的，只有点了「显示释义」才出现，
 * 所以那段 HTML 在初始页面里根本不存在，查不到。
 *
 * 这里用 React 自带的 renderToStaticMarkup 把组件渲染成 HTML 字符串，
 * 就能直接断言「显示释义之后，答案确实出现了、按钮确实消失了」。
 * 不需要浏览器，也不需要额外装测试框架。
 *
 * 运行方式：npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RatingButtons } from "./RatingButtons";
import { WordCard } from "./WordCard";
import type { Word } from "@/types";

/** 测试用的假单词，内容固定，方便精确断言 */
const WORD: Word = {
  id: 1,
  word: "abandon",
  phonetic: "/əˈbændən/",
  part_of_speech: "vt.",
  meaning: "放弃；抛弃",
  example: "Many researchers refuse to abandon the traditional theory.",
  example_translation: "许多研究者拒绝放弃这一传统理论。",
  difficulty: 2,
  created_at: "",
};

/** 空函数，代替真实的事件处理 */
const noop = () => undefined;

describe("WordCard：释义的显示与隐藏", () => {
  it("还没点「显示释义」时，只有问题、没有答案", () => {
    const html = renderToStaticMarkup(
      <WordCard word={WORD} revealed={false} onReveal={noop} />,
    );

    // 应该看得见的：单词、音标、词性
    assert.match(html, /abandon/);
    assert.match(html, /əˈbændən/);
    assert.match(html, /vt\./);
    assert.match(html, /显示释义/);

    // 不该提前泄露的：中文释义和例句
    assert.ok(
      !html.includes("放弃；抛弃"),
      "释义在点击之前不应该出现在页面里",
    );
    assert.ok(
      !html.includes("Many researchers"),
      "例句在点击之前不应该出现在页面里",
    );
  });

  it("点过「显示释义」之后，答案出现、按钮消失", () => {
    const html = renderToStaticMarkup(
      <WordCard word={WORD} revealed={true} onReveal={noop} />,
    );

    assert.match(html, /放弃；抛弃/);
    assert.match(html, /Many researchers/);
    assert.match(html, /许多研究者拒绝放弃这一传统理论。/);

    assert.ok(
      !html.includes("显示释义"),
      "已经显示答案了，就不该还留着「显示释义」按钮",
    );
  });

  it("例句用宽松行距，长时间看不容易累", () => {
    const html = renderToStaticMarkup(
      <WordCard word={WORD} revealed={true} onReveal={noop} />,
    );
    assert.match(html, /leading-7/);
  });

  it("单词用大字号，并且在小屏和大屏上分档", () => {
    const html = renderToStaticMarkup(
      <WordCard word={WORD} revealed={false} onReveal={noop} />,
    );
    assert.match(html, /text-4xl/);
    assert.match(html, /sm:text-5xl/);
  });

  it("键盘提示只是装饰，读屏软件应该跳过", () => {
    const html = renderToStaticMarkup(
      <WordCard word={WORD} revealed={false} onReveal={noop} />,
    );
    assert.match(html, /aria-hidden="true"/);
  });
});

describe("WordCard：新词 / 复习 角标", () => {
  it("isNew 为 true 时显示「新词」", () => {
    const html = renderToStaticMarkup(
      <WordCard word={WORD} revealed={false} onReveal={noop} isNew={true} />,
    );
    assert.match(html, /新词/);
    assert.match(html, /bg-sky-100/);
    assert.ok(!html.includes("复习"), "不该同时出现两个角标");
  });

  it("isNew 为 false 时显示「复习」", () => {
    const html = renderToStaticMarkup(
      <WordCard word={WORD} revealed={false} onReveal={noop} isNew={false} />,
    );
    assert.match(html, /复习/);
    assert.match(html, /bg-amber-100/);
  });

  it("不传 isNew 时干脆不显示角标", () => {
    const html = renderToStaticMarkup(
      <WordCard word={WORD} revealed={false} onReveal={noop} />,
    );
    assert.ok(!html.includes("新词"), "没传 isNew 就不该出现角标");
    assert.ok(!html.includes("复习"));
  });
});

describe("RatingButtons：三个作答按钮", () => {
  it("三个按钮和中英文标签都在", () => {
    const html = renderToStaticMarkup(
      <RatingButtons onRate={noop} />,
    );

    assert.match(html, /不认识/);
    assert.match(html, /模糊/);
    assert.match(html, /认识/);
  });

  it("把算法算出的间隔显示在每个按钮下面", () => {
    const html = renderToStaticMarkup(
      <RatingButtons
        onRate={noop}
        hints={{ again: "10 分钟后", hard: "1 天后", good: "3 天后" }}
      />,
    );

    assert.match(html, /10 分钟后/);
    assert.match(html, /1 天后/);
    assert.match(html, /3 天后/);
  });

  it("没有传入提示时不显示空的小字", () => {
    const html = renderToStaticMarkup(<RatingButtons onRate={noop} />);
    assert.ok(!html.includes("undefined"), "不能把 undefined 渲染到页面上");
  });

  it("键盘提示在窄屏隐藏，并且不对读屏软件朗读", () => {
    const html = renderToStaticMarkup(<RatingButtons onRate={noop} />);
    // hidden = 默认隐藏，sm:block = 宽屏才显示
    assert.match(html, /hidden/);
    assert.match(html, /sm:block/);
    assert.match(html, /aria-hidden="true"/);
  });

  it("保存中时按钮被禁用，防止连点记成两次", () => {
    const html = renderToStaticMarkup(
      <RatingButtons onRate={noop} disabled={true} />,
    );
    assert.match(html, /disabled/);
  });
});
