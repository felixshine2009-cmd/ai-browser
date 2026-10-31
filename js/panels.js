let ggbFrame, physFrame, active='ggb';
export function mount(holder){
  if (!holder) return;
  ggbFrame = document.createElement('iframe'); ggbFrame.className='panel-frame'; ggbFrame.title='GeoGebra'; ggbFrame.src='panels-ggb.html';
  physFrame = document.createElement('iframe'); physFrame.className='panel-frame'; physFrame.title='Physics'; physFrame.src='panels-phys.html'; physFrame.style.display='none';
  holder.innerHTML=''; holder.appendChild(ggbFrame); holder.appendChild(physFrame);
  window.addEventListener('resize', resize); if (window.visualViewport) visualViewport.addEventListener('resize', resize);
  resize();
}
function resize(){
  [ggbFrame, physFrame].forEach(f=>{
    if (!f) return;
    // panels handle devicePixelRatio themselves; force a reflow so canvases resize
    f.style.height = '100%';
  });
}
export function show(which, open){
  active = which;
  if (open !== false) document.body.classList.add('panel-open');
  if (ggbFrame) ggbFrame.style.display = which==='ggb'?'':'none';
  if (physFrame) physFrame.style.display = which==='phys'?'':'none';
}
export function call(which, method, args){
  const f = which==='phys'?physFrame:ggbFrame;
  if (!f || !f.contentWindow) return Promise.reject(new Error('panel not ready'));
  return new Promise((resolve,reject)=>{
    const id = Math.random().toString(36).slice(2);
    const onMsg = (ev)=>{
      if (ev.source !== f.contentWindow) return;
      const m = ev.data; if (!m || m.aibPanelReply !== id) return;
      window.removeEventListener('message', onMsg);
      m.error ? reject(new Error(m.error)) : resolve(m.result);
    };
    window.addEventListener('message', onMsg);
    f.contentWindow.postMessage({ aibPanelCall:id, method, args:args||{} }, '*');
    setTimeout(()=>{ window.removeEventListener('message', onMsg); reject(new Error('panel timeout')); }, 60000);
  });
}
export function closeOverlay(){ document.body.classList.remove('panel-open'); }
export function getActive(){ return active; }
