(() => {
  const ROOT_ID="focus-buffer-root", BYPASS="focus-buffer-bypass-url", SESSION="focus-buffer-session-usage";
  const DEFAULTS=["instagram.com","facebook.com","youtube.com"], WAIT=10, INTERVAL=5000;
  if(window.top!==window||document.getElementById(ROOT_ID)) return;
  const page=location.origin+location.pathname;
  let target="", elapsed=0, limit=300, timer=null, last=0, closing=false;
  init().catch(console.error);
  async function init(){
    const s=await browser.storage.local.get(["blockedTargets","limitMinutes"]);
    const matches=(Array.isArray(s.blockedTargets)?s.blockedTargets:DEFAULTS).map(normalize).filter(x=>x&&matchesTarget(x)).sort((a,b)=>b.length-a.length);
    if(!matches.length)return;
    target=matches[0]; limit=(Math.max(1,Number(s.limitMinutes)||5))*60;
    if(get(BYPASS)===page){elapsed=Number(get(SESSION)||0);start();return;}
    const data=await browser.storage.local.get("dailyUsage"), today=(data.dailyUsage||{})[day()]||{};
    const total=Object.values(today).reduce((a,b)=>a+Number(b||0),0);
    overlay(Number(today[target]||0),total);
  }
  function el(tag,cls,txt){const n=document.createElement(tag);if(cls)n.className=cls;if(txt)n.textContent=txt;return n;}
  function overlay(site,total){
    const root=el("div");root.id=ROOT_ID;root.setAttribute("role","dialog");root.setAttribute("aria-modal","true");
    const shell=el("main","fb-shell"),panel=el("section","fb-panel");
    panel.append(el("p","fb-kicker","先暫停一下"),el("h1","","你剛剛打開了 "+siteName(location.hostname)),el("p","fb-copy","不然你先去喝一口水，看看待辦清單，伸展 30 秒。等一下再決定要不要繼續。"));
    const stats=el("div","fb-usage");stats.append(card(minutes(site),"今天在這個網站"),card(minutes(total),"今天所有限制網站"));
    const tasks=el("div","fb-actions-list");tasks.append(task("1","喝一口水"),task("2","看一下今天最重要的待辦"),task("3","站起來伸展 30 秒"));
    const actions=el("div","fb-controls"),close=button("關掉這頁","close","fb-button fb-button-primary"),proceed=button("我真的要繼續","continue","fb-button fb-button-secondary");
    actions.append(close,proceed);const status=el("p","fb-status");status.setAttribute("aria-live","polite");panel.append(stats,tasks,actions,status);shell.append(panel);root.append(shell);
    const mount=()=>{if(!document.documentElement.contains(root))document.documentElement.append(root);};if(document.documentElement)mount();else document.addEventListener("DOMContentLoaded",mount,{once:true});
    root.addEventListener("click",e=>{const action=e.target.closest("button[data-action]")?.dataset.action;if(action==="close")send({type:"CLOSE_DISTRACTION_TAB"});if(action==="continue")countdown(root,proceed,close,status);});
  }
  function card(value,label){const n=el("div");n.append(el("span","fb-usage-number",value),el("span","fb-usage-label",label));return n;}
  function task(no,label){const n=el("div","fb-task");n.append(el("span","fb-task-mark",no),el("span","",label));return n;}
  function button(label,action,cls){const n=el("button",cls,label);n.type="button";n.dataset.action=action;return n;}
  function countdown(root,proceed,close,status){if(proceed.disabled)return;let left=WAIT;proceed.disabled=true;close.focus();const tick=()=>{status.textContent="先等 "+left+" 秒。繼續後使用 "+Math.ceil(limit/60)+" 分鐘就會自動關閉。";proceed.textContent=left+" 秒後繼續";};tick();const id=setInterval(()=>{left--;if(left<=0){clearInterval(id);put(BYPASS,page);put(SESSION,"0");elapsed=0;root.remove();start();}else tick();},1000);}
  function start(){if(timer||closing||!target||document.visibilityState!=="visible")return;last=Date.now();timer=setInterval(track,INTERVAL);document.addEventListener("visibilitychange",visibility);window.addEventListener("pagehide",flush);window.addEventListener("pageshow",shown);}
  function stop(){if(timer)clearInterval(timer);timer=null;last=0;}
  function visibility(){if(document.visibilityState==="visible"){if(!timer&&!closing)start();}else{flush();stop();}}
  function shown(){if(get(BYPASS)===page&&document.visibilityState==="visible"&&!timer&&!closing)start();}
  function track(){if(document.visibilityState!=="visible"){flush();stop();return;}const now=Date.now(),sec=Math.max(0,Math.floor((now-last)/1000));last=now;if(sec)record(sec);if(elapsed>=limit)closeTab();}
  function flush(){if(!last)return;const sec=Math.max(0,Math.floor((Date.now()-last)/1000));last=0;if(sec)record(sec);if(elapsed>=limit)closeTab();}
  function record(sec){elapsed+=sec;put(SESSION,String(elapsed));send({type:"ADD_USAGE_SECONDS",target,seconds:sec,dayKey:day()});}
  function closeTab(){if(closing)return;closing=true;stop();send({type:"CLOSE_DISTRACTION_TAB"});}
  async function send(msg){try{await browser.runtime.sendMessage(msg);}catch(e){console.error(e);}}
  function matchesTarget(t){if(/^https?:\/\//.test(t))return(page.toLowerCase()).startsWith(t);return location.hostname===t||location.hostname.endsWith("."+t);}
  function normalize(v){v=String(v||"").trim().toLowerCase();if(/^https?:\/\//.test(v)){try{const u=new URL(v);return u.origin+(u.pathname==="/"?"":u.pathname.replace(/\/+$/,""));}catch{return"";}}return v.replace(/^www\./,"").replace(/\/+$/,"");}
  function siteName(h){return h.endsWith("instagram.com")?"Instagram":h.endsWith("facebook.com")?"Facebook":h.endsWith("youtube.com")?"YouTube":h;}
  function minutes(s){return Math.floor(Number(s||0)/60)+" 分鐘";}
  function day(){const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");}
  function get(k){try{return sessionStorage.getItem(k);}catch{return null;}}
  function put(k,v){try{sessionStorage.setItem(k,v);}catch{}}
})();