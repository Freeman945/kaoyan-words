"use client";

/**
 * 「打印」按钮。
 *
 * 之所以只有这么几行：浏览器的打印功能本身就够用（手机上有「打印 / 存为 PDF」），
 * 我们要做的只是**在能打印的地方给一个明显的按钮** ——
 * 不然用户得自己去找浏览器菜单里的「打印」，很多人找不到。
 *
 * window.print() 会弹出系统打印对话框，那里可以选打印机，
 * 也可以选「另存为 PDF」。
 */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={
        "rounded-lg bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white " +
        "transition-colors hover:bg-zinc-700"
      }
    >
      打印
    </button>
  );
}
