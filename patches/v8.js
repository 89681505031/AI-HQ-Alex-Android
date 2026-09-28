/* AI HQ V8 — Execution Gateway */
(() => {
  const V8_VERSION = '8.0';
  const JOB_TYPES = [
    ['github.create_repo','Создать GitHub-репозиторий'],
    ['github.commit','Записать файлы в GitHub'],
    ['test.run','Запустить тесты'],
    ['apk.build','Собрать APK'],
    ['vercel.deploy','Развернуть сайт на Vercel'],
    ['release.publish','Опубликовать релиз']
  ];

  function ensureV8(){
    state.v8 = state.v8 || {};
    state.v8.jobs = Array.isArray(state.v8.jobs) ? state.v8.jobs : [];
    state.v8.logs = Array.isArray(state.v8.logs) ? state.v8.logs : [];
    state.v8.artifacts = Array.isArray(state.v8.artifacts) ? state.v8.artifacts : [];
    state.v8.settings = {
      mode:'local',
      gatewayUrl:'',
      autoPoll:true,
      requirePublishApproval:true,
      ...state.v8.settings
    };
    state.v8.approvals = Array.isArray(state.v8.approvals) ? state.v8.approvals : [];
    save();
  }

  function sessionToken(){
    try{return sessionStorage.getItem('aihq_v8_gateway_token') || '';}catch(e){return '';}
  }
  function setSessionToken(v){
    try{if(v)sessionStorage.setItem('aihq_v8_gateway_token',v);else sessionStorage.removeItem('aihq_v8_gateway_token');}catch(e){}
  }

  function logV8(action, details='', jobId='', level='info'){
    ensureV8();
    state.v8.logs.unshift({id:uid('xlog'),action,details,jobId,level,time:`${todayLabel()} ${nowLabel()}`});
    state.v8.logs=state.v8.logs.slice(0,400);
    if(state.v6?.audit){
      state.v6.audit.unshift({id:uid('audit'),action:'V8 · '+action,details,missionId:'',level,time:`${todayLabel()} ${nowLabel()}`});
      state.v6.audit=state.v6.audit.slice(0,350);
    }
    save();
  }

  function jobById(id){return state.v8.jobs.find(j=>j.id===id);}
  function missionName(id){return state.missions.find(m=>m.id===id)?.title || 'Без миссии';}
  function projectName(id){return project(id)?.name || 'Без проекта';}
  function isTerminal(j){return ['success','failed','cancelled'].includes(j.status);}
  function jobLabel(type){return JOB_TYPES.find(x=>x[0]===type)?.[1] || type;}

  function addJob(type,{projectId='',missionId='',payload={},dependsOn=[]}={}){
    ensureV8();
    const j={
      id:uid('job'),type,status:'queued',projectId,missionId,payload,
      dependsOn:[...dependsOn],attempts:0,progress:0,result:null,error:'',
      created:`${todayLabel()} ${nowLabel()}`,updated:`${todayLabel()} ${nowLabel()}`
    };
    state.v8.jobs.push(j);
    logV8('Задание создано', `${jobLabel(type)} · ${projectName(projectId)}`, j.id);
    save();
    return j;
  }

  function planExternalWork(missionId){
    ensureV8();
    const m=state.missions.find(x=>x.id===missionId);
    if(!m)return toast('Миссия не найдена');
    const p=project(m.projectId);
    const existing=state.v8.jobs.filter(j=>j.missionId===missionId && !['failed','cancelled'].includes(j.status));
    if(existing.length)return toast('Для этой миссии уже есть рабочий конвейер');

    const repoJob=addJob('github.create_repo',{projectId:m.projectId,missionId,payload:{name:(p?.name||m.title).replace(/\s+/g,'-'),private:false}});
    const commitJob=addJob('github.commit',{projectId:m.projectId,missionId,dependsOn:[repoJob.id],payload:{source:'project-workspace',branch:'main'}});
    const testJob=addJob('test.run',{projectId:m.projectId,missionId,dependsOn:[commitJob.id],payload:{suite:'auto'}});
    let buildOrDeploy;
    const type=String(p?.type||'').toLowerCase();
    if(/android|apk/.test(type)){
      buildOrDeploy=addJob('apk.build',{projectId:m.projectId,missionId,dependsOn:[testJob.id],payload:{variant:'debug'}});
    }else{
      buildOrDeploy=addJob('vercel.deploy',{projectId:m.projectId,missionId,dependsOn:[testJob.id],payload:{environment:'preview'}});
    }
    addJob('release.publish',{projectId:m.projectId,missionId,dependsOn:[buildOrDeploy.id],payload:{channel:'director-approved'}});
    logV8('АРГО сформировал внешний конвейер', `${m.title}: 5 заданий`, '', 'info');
    addMemory('Внешний конвейер', `АРГО подготовил реальный исполнительный план для миссии «${m.title}»: GitHub → тесты → сборка/деплой → публикация.`, m.projectId, 'АРГО');
    save();render();toast('Внешний конвейер создан');
  }

  function depsReady(job){
    return (job.dependsOn||[]).every(id=>jobById(id)?.status==='success');
  }

  function publishApproval(job){
    if(job.type!=='release.publish' || !state.v8.settings.requirePublishApproval)return true;
    const existing=state.v8.approvals.find(a=>a.jobId===job.id && a.status==='pending');
    if(existing)return false;
    if(job.approved)return true;
    state.v8.approvals.unshift({
      id:uid('xapproval'),jobId:job.id,status:'pending',
      title:`Публикация: ${projectName(job.projectId)}`,
      created:`${todayLabel()} ${nowLabel()}`
    });
    job.status='approval';
    logV8('Запрошено одобрение публикации', projectName(job.projectId), job.id, 'warning');
    save();render();
    return false;
  }

  function approveExternal(id){
    const a=state.v8.approvals.find(x=>x.id===id);if(!a)return;
    const j=jobById(a.jobId);if(!j)return;
    a.status='approved';a.decided=`${todayLabel()} ${nowLabel()}`;
    j.approved=true;j.status='queued';
    logV8('Директор одобрил публикацию',projectName(j.projectId),j.id);
    save();render();toast('Публикация одобрена');
  }
  function rejectExternal(id){
    const a=state.v8.approvals.find(x=>x.id===id);if(!a)return;
    const j=jobById(a.jobId);if(!j)return;
    a.status='rejected';a.decided=`${todayLabel()} ${nowLabel()}`;
    j.status='cancelled';j.error='Отклонено директором';
    logV8('Директор отклонил публикацию',projectName(j.projectId),j.id,'warning');
    save();render();toast('Публикация отменена');
  }

  function localArtifact(job,name,url=''){
    const a={id:uid('artifact'),jobId:job.id,projectId:job.projectId,name,url,created:`${todayLabel()} ${nowLabel()}`};
    state.v8.artifacts.unshift(a);state.v8.artifacts=state.v8.artifacts.slice(0,150);return a;
  }

  async function runLocal(job){
    job.status='running';job.attempts++;job.progress=10;job.updated=`${todayLabel()} ${nowLabel()}`;
    logV8('Локальный исполнитель начал задание',jobLabel(job.type),job.id);
    save();render();
    await new Promise(r=>setTimeout(r,180));
    job.progress=55;save();render();
    await new Promise(r=>setTimeout(r,180));
    const fake = {
      'github.create_repo':()=>({repo:`local://github/${(job.payload?.name||'project')}`,message:'Репозиторий смоделирован локально'}),
      'github.commit':()=>({commit:'local-'+uid('c').slice(-8),files:'workspace'}),
      'test.run':()=>({passed:true,tests:12,failed:0}),
      'apk.build':()=>({artifact:localArtifact(job,`${projectName(job.projectId)}-debug.apk`).id}),
      'vercel.deploy':()=>({url:`local://preview/${String(projectName(job.projectId)).toLowerCase().replace(/\s+/g,'-')}`}),
      'release.publish':()=>({released:true,channel:'local'})
    }[job.type];
    job.result=fake?fake():{ok:true};
    job.progress=100;job.status='success';job.error='';job.updated=`${todayLabel()} ${nowLabel()}`;
    logV8('Задание завершено',`${jobLabel(job.type)} · локальный режим`,job.id);
    save();render();return true;
  }

  function gatewayHeaders(){
    const h={'Content-Type':'application/json'};
    const token=sessionToken();if(token)h['Authorization']='Bearer '+token;
    return h;
  }
  function gatewayBase(){return String(state.v8.settings.gatewayUrl||'').trim().replace(/\/$/,'');}

  async function gatewayRequest(path,options={}){
    const base=gatewayBase();if(!base)throw new Error('Не указан адрес Execution Gateway');
    const r=await fetch(base+path,{...options,headers:{...gatewayHeaders(),...(options.headers||{})}});
    let body=null;try{body=await r.json();}catch(e){body={text:await r.text().catch(()=> '')};}
    if(!r.ok)throw new Error(body?.error||body?.message||`HTTP ${r.status}`);
    return body;
  }

  async function testGateway(){
    try{
      const t=Date.now();
      const body=await gatewayRequest('/health',{method:'GET'});
      state.v8.gatewayHealth={ok:true,latency:Date.now()-t,body,time:`${todayLabel()} ${nowLabel()}`};
      logV8('Gateway доступен',`${state.v8.gatewayHealth.latency} ms`);
      save();render();toast('Gateway подключён');
    }catch(e){
      state.v8.gatewayHealth={ok:false,error:String(e.message||e),time:`${todayLabel()} ${nowLabel()}`};
      logV8('Ошибка Gateway',String(e.message||e),'','error');
      save();render();toast('Gateway недоступен');
    }
  }

  async function submitGateway(job){
    if(job.type==='release.publish' && !publishApproval(job))return false;
    job.status='running';job.attempts++;job.progress=5;save();render();
    try{
      const body=await gatewayRequest('/jobs',{method:'POST',body:JSON.stringify({
        clientJobId:job.id,type:job.type,projectId:job.projectId,missionId:job.missionId,payload:job.payload
      })});
      job.remoteId=body.id||body.jobId||job.id;
      job.status=body.status||'running';job.progress=Number(body.progress||10);job.result=body.result||null;
      logV8('Задание отправлено в Gateway',`${jobLabel(job.type)} · ${job.remoteId}`,job.id);
      save();render();
      if(isTerminal(job))return job.status==='success';
      return await pollGateway(job);
    }catch(e){
      job.status='failed';job.error=String(e.message||e);job.updated=`${todayLabel()} ${nowLabel()}`;
      logV8('Ошибка внешнего задания',`${jobLabel(job.type)}: ${job.error}`,job.id,'error');
      save();render();return false;
    }
  }

  async function pollGateway(job){
    for(let i=0;i<24;i++){
      await new Promise(r=>setTimeout(r,700));
      if(job.status==='cancelled')return false;
      try{
        const body=await gatewayRequest('/jobs/'+encodeURIComponent(job.remoteId||job.id),{method:'GET'});
        job.status=body.status||job.status;job.progress=Number(body.progress??job.progress);job.result=body.result??job.result;job.error=body.error||'';
        if(Array.isArray(body.artifacts)){
          body.artifacts.forEach(a=>{
            if(!state.v8.artifacts.some(x=>x.url===a.url && x.jobId===job.id)) state.v8.artifacts.unshift({id:uid('artifact'),jobId:job.id,projectId:job.projectId,name:a.name||'artifact',url:a.url||'',created:`${todayLabel()} ${nowLabel()}`});
          });
        }
        job.updated=`${todayLabel()} ${nowLabel()}`;save();render();
        if(isTerminal(job)){
          logV8(job.status==='success'?'Внешнее задание завершено':'Внешнее задание остановлено',jobLabel(job.type),job.id,job.status==='success'?'info':'error');
          save();return job.status==='success';
        }
      }catch(e){
        if(i===23){job.status='failed';job.error=String(e.message||e);save();return false;}
      }
    }
    job.status='failed';job.error='Gateway не завершил задание вовремя';save();return false;
  }

  async function runJob(id){
    const job=jobById(id);if(!job)return;
    if(!depsReady(job))return toast('Сначала должны завершиться предыдущие задания');
    if(job.type==='release.publish' && !publishApproval(job))return toast('Требуется одобрение директора');
    job.error='';
    if(state.v8.settings.mode==='gateway')await submitGateway(job);else await runLocal(job);
  }

  async function runPipeline(missionId=''){
    ensureV8();
    const list=state.v8.jobs.filter(j=>(!missionId||j.missionId===missionId)&&!isTerminal(j));
    for(let guard=0;guard<40;guard++){
      const next=list.find(j=>['queued','failed'].includes(j.status) && depsReady(j));
      if(!next)break;
      const ok=await (state.v8.settings.mode==='gateway'?submitGateway(next):runLocal(next));
      if(!ok)break;
    }
    save();render();
  }

  function resetFailed(id){
    const j=jobById(id);if(!j)return;j.status='queued';j.error='';j.progress=0;save();render();toast('Задание возвращено в очередь');
  }
  function cancelJob(id){
    const j=jobById(id);if(!j||isTerminal(j))return;j.status='cancelled';j.error='Отменено директором';save();render();toast('Задание отменено');
  }

  function executionPage(){
    ensureV8();
    const pending=state.v8.approvals.filter(a=>a.status==='pending');
    const jobs=[...state.v8.jobs].reverse();
    const running=jobs.filter(j=>j.status==='running').length, failed=jobs.filter(j=>j.status==='failed').length, success=jobs.filter(j=>j.status==='success').length;
    const health=state.v8.gatewayHealth;
    return `<section class="card v8-hero"><div><div class="director-title">AI HQ V${V8_VERSION}</div><h3>Центр исполнения</h3><p class="meta">Миссия → GitHub → тесты → сборка/деплой → одобрение → релиз</p></div><div class="hero-actions"><button class="btn primary" data-v8-run-all>▶ Выполнить очередь</button><button class="btn" data-v8-test>Проверить Gateway</button></div></section>
    <div class="stats v8-stats"><div class="stat"><b>${running}</b><span>Выполняются</span></div><div class="stat"><b>${success}</b><span>Готово</span></div><div class="stat"><b>${failed}</b><span>Ошибки</span></div><div class="stat"><b>${state.v8.artifacts.length}</b><span>Артефакты</span></div></div>
    <div class="section-head"><h3>Подключение исполнителя</h3><span>${state.v8.settings.mode==='gateway'?'Gateway':'Локально'}</span></div>
    <section class="card v8-connect"><label>Режим<select id="v8Mode"><option value="local" ${state.v8.settings.mode==='local'?'selected':''}>Локальная симуляция</option><option value="gateway" ${state.v8.settings.mode==='gateway'?'selected':''}>Execution Gateway</option></select></label><label>HTTPS-адрес Gateway<input id="v8Url" placeholder="https://gateway.example.com" value="${esc(state.v8.settings.gatewayUrl||'')}"></label><label>Токен текущей сессии<input id="v8Token" type="password" placeholder="Не сохраняется в localStorage" value=""></label><div class="v8-health ${health?.ok?'ok':health?'bad':''}">${health?health.ok?`● Подключено · ${health.latency} ms`:`● Ошибка: ${esc(health.error||'')}`:'● Соединение не проверено'}</div></section>
    ${pending.length?`<div class="section-head"><h3>Решения директора</h3><span>${pending.length}</span></div><div class="v8-approvals">${pending.map(a=>{const j=jobById(a.jobId);return `<article class="card v8-approval"><div><b>${esc(a.title)}</b><p class="meta">${esc(jobLabel(j?.type||''))}</p></div><div class="v8-actions"><button class="btn primary mini" data-v8-approve="${a.id}">Опубликовать</button><button class="btn danger mini" data-v8-reject="${a.id}">Отклонить</button></div></article>`}).join('')}</div>`:''}
    <div class="section-head"><h3>Рабочая очередь</h3><span>${jobs.length}</span></div>
    <div class="v8-jobs">${jobs.map(j=>`<article class="card v8-job"><div class="row between"><div><b>${esc(jobLabel(j.type))}</b><div class="meta">${esc(projectName(j.projectId))} · ${esc(missionName(j.missionId))}</div></div><span class="v8-status ${j.status}">${esc(j.status)}</span></div><div class="progress"><i style="width:${Math.max(0,Math.min(100,j.progress||0))}%"></i></div>${j.error?`<p class="v8-error">${esc(j.error)}</p>`:''}<div class="row between"><span class="meta">Попыток: ${j.attempts||0}</span><div class="v8-actions">${['queued','failed'].includes(j.status)?`<button class="btn mini" data-v8-run="${j.id}">Запустить</button>`:''}${j.status==='failed'?`<button class="btn mini" data-v8-reset="${j.id}">Повторить</button>`:''}${!isTerminal(j)&&j.status!=='approval'?`<button class="btn mini" data-v8-cancel="${j.id}">Отмена</button>`:''}</div></div></article>`).join('')||'<div class="empty">Пока нет внешних заданий. Откройте миссию и создайте исполнительный конвейер.</div>'}</div>
    <div class="section-head"><h3>Артефакты</h3><span>${state.v8.artifacts.length}</span></div>
    <div class="v8-artifacts">${state.v8.artifacts.slice(0,30).map(a=>`<article class="card v8-artifact"><div><b>${esc(a.name)}</b><div class="meta">${esc(projectName(a.projectId))} · ${esc(a.created)}</div></div>${a.url?`<button class="btn mini" data-v8-open="${esc(a.url)}">Открыть</button>`:''}</article>`).join('')||'<div class="empty">Артефактов пока нет.</div>'}</div>
    <div class="section-head"><h3>Журнал исполнения</h3><span>${state.v8.logs.length}</span></div>
    <div class="v6-audit">${state.v8.logs.slice(0,50).map(x=>`<div class="v6-audit-row ${x.level}"><div class="v6-audit-dot"></div><div><b>${esc(x.action)}</b><p>${esc(x.details)}</p></div><time>${esc(x.time)}</time></div>`).join('')||'<div class="empty">Журнал пуст.</div>'}</div>`;
  }

  const oldRenderPage=renderPage;
  renderPage=function(){if(state.nav==='execute')return executionPage();return oldRenderPage();};

  renderNav=function(){
    const nav=[['office','⌂','Офис'],['projects','▤','Проекты'],['command','▦','Центр'],['hierarchy','⌘','Структура'],['execute','▶','Исполнение'],['meetings','◎','Совещания'],['studio','◇','Студия'],['director','◆','Директор']];
    return `<nav class="bottom-nav v8-nav">${nav.map(n=>`<button class="nav-btn ${state.nav===n[0]?'active':''}" data-nav="${n[0]}"><strong>${n[1]}</strong>${n[2]}</button>`).join('')}</nav>`;
  };

  const oldDirectorPage=directorPage;
  directorPage=function(){
    return `<section class="card v8-director"><div><b>Центр исполнения V8</b><p class="meta">Реальные внешние задания, сборки, деплои, артефакты и одобрение публикации.</p></div><button class="btn primary" data-navgo="execute">Открыть исполнение</button></section>${oldDirectorPage().replace(/V7\.0/g,'V8.0')}`;
  };

  const oldOpenMission=openMission;
  openMission=function(id){
    oldOpenMission(id);
    const m=state.missions.find(x=>x.id===id);if(!m)return;
    const actions=$('.hero-actions',$('#modal-root'));
    if(actions){
      const b=document.createElement('button');b.className='btn primary';b.textContent='Создать внешний конвейер';b.onclick=()=>planExternalWork(id);actions.appendChild(b);
      const has=state.v8.jobs.some(j=>j.missionId===id);
      if(has){const r=document.createElement('button');r.className='btn';r.textContent='Выполнить конвейер';r.onclick=()=>runPipeline(id);actions.appendChild(r);}
    }
  };

  const oldBindGlobal=bindGlobal;
  bindGlobal=function(){
    oldBindGlobal();
    $$('[data-v8-run-all]').forEach(b=>b.onclick=()=>runPipeline(''));
    $$('[data-v8-test]').forEach(b=>b.onclick=testGateway);
    $$('[data-v8-run]').forEach(b=>b.onclick=()=>runJob(b.dataset.v8Run));
    $$('[data-v8-reset]').forEach(b=>b.onclick=()=>resetFailed(b.dataset.v8Reset));
    $$('[data-v8-cancel]').forEach(b=>b.onclick=()=>cancelJob(b.dataset.v8Cancel));
    $$('[data-v8-approve]').forEach(b=>b.onclick=()=>approveExternal(b.dataset.v8Approve));
    $$('[data-v8-reject]').forEach(b=>b.onclick=()=>rejectExternal(b.dataset.v8Reject));
    $$('[data-v8-open]').forEach(b=>b.onclick=()=>{const u=b.dataset.v8Open;if(/^https?:\/\//i.test(u))window.open(u,'_blank');else toast(u)});
    const mode=$('#v8Mode');if(mode)mode.onchange=()=>{state.v8.settings.mode=mode.value;save();render()};
    const url=$('#v8Url');if(url)url.onchange=()=>{state.v8.settings.gatewayUrl=url.value.trim();save()};
    const tok=$('#v8Token');if(tok)tok.onchange=()=>{setSessionToken(tok.value.trim());toast(tok.value?'Токен сохранён только для текущей сессии':'Токен очищен')};
  };

  ensureV8();
  logV8('AI HQ V8 активирован','Центр исполнения готов: локальный режим + внешний Execution Gateway');
  save();render();
})();