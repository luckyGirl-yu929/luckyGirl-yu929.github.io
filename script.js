/* BYME · 交互脚本：滚动入场 + 傲娇气泡 + 点 IP 跳一下 */
(function () {
  "use strict";

  /* ---------- 1. 滚动入场动画 ---------- */
  const reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add("is-visible"));
  }

  /* ---------- 2. 傲娇气泡轮换 + 点她跳一下 ---------- */
  const bubble = document.getElementById("bubble");
  const ip = document.getElementById("ip-hero");

  const LINES = [
    "……哦，是你啊。<br/>那，随便看看吧。",
    "别戳我。<br/>……好吧，再戳一下也行。",
    "作品集在下面。<br/>看完再走，不许白嫖。",
    "Be Yourself，<br/>懂？我才不装热情。",
    "还在看？<br/>……行吧，有点眼光。",
  ];
  let lineIdx = 0;

  function say(idx) {
    if (!bubble) return;
    bubble.style.opacity = "0";
    setTimeout(() => {
      bubble.innerHTML = LINES[idx % LINES.length];
      bubble.style.opacity = "1";
    }, 220);
  }

  if (bubble) {
    bubble.style.transition = "opacity 220ms ease";
    // 每 6 秒自动换一句
    setInterval(() => {
      lineIdx += 1;
      say(lineIdx);
    }, 6000);
  }

  if (ip) {
    ip.addEventListener("click", () => {
      // 跳一下 + 立刻换台词
      ip.classList.remove("ip-jump");
      void ip.offsetWidth; // 强制重排以重启动画
      ip.classList.add("ip-jump");
      lineIdx += 1;
      say(lineIdx);
    });
  }
})();
