'use strict';
document.querySelectorAll('[data-scene]').forEach(button=>button.addEventListener('click',()=>{
 document.querySelectorAll('[data-scene]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
 const number=button.dataset.scene.padStart(2,'0');
 document.getElementById('scene-title').textContent=`场景 ${number} · 名称待报告确认`;
 document.getElementById('observation').textContent=`场景 ${number}：尚无可核实的观察结论。等待原始报告、视频与样本编号。`;
 document.querySelectorAll('#comparison video').forEach(video=>video.pause());
}));
if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
 const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('arrived');observer.unobserve(entry.target);}}),{threshold:.08});
 document.querySelectorAll('main>section:not(.hero)').forEach(section=>observer.observe(section));
}
