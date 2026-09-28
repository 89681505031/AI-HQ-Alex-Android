/* AI HQ V7 — Company Hierarchy */
(() => {
  const V7_VERSION = '7.0';
  const DEPTS = ['Продукт','Разработка','Дизайн','Качество','Безопасность','ИИ-центр','Бизнес'];

  function ensureV7() {
    state.v7 = state.v7 || {};
    state.v7.reviews = Array.isArray(state.v7.reviews) ? state.v7.reviews : [];
    state.v7.handoffs = Array.isArray(state.v7.handoffs) ? state.v7.handoffs : [];
    state.v7.reports = Array.isArray(state.v7.reports) ? state.v7.reports : [];
    state.v7.org = state.v7.org || {};
    state.v7.settings = {
      managerReview: 'all',
      stopOnManagerReject: true,
      executiveReport: true,
      ...state.v7.settings
    };
    save();
  }

  const roleText = a => String(a?.role || a?.title || a?.specialty || '').toLowerCase();
  const depText = a => String(a?.department || a?.dept || '').toLowerCase();

  function taskDepartment(task) {
    const x = String((task?.role || '') + ' ' + (task?.title || '')).toLowerCase();
    if (/security|безопас/.test(x)) return 'Безопасность';
    if (/qa|test|тест|quality|review|performance|качест/.test(x)) return 'Качество';
    if (/ui|ux|design|дизайн|motion|graphic/.test(x)) return 'Дизайн';
    if (/prompt|data analyst|ai researcher|automation|ии|ml|ai engineer/.test(x)) return 'ИИ-центр';
    if (/marketing|seo|content|finance|business|бизнес|маркет|финанс/.test(x)) return 'Бизнес';
    if (/product manager|business analyst|аналитик|product|требован/.test(x)) return 'Продукт';
    return 'Разработка';
  }

  function headScore(agent, dept) {
    const r = roleText(agent), d = depText(agent);
    let s = 0;
    if (d.includes(dept.toLowerCase())) s += 5;
    if (agent?.isHead || agent?.head || agent?.lead || agent?.manager) s += 6;
    const patterns = {
      'Продукт': /product manager|руковод|директор продукт|аналитик/,
      'Разработка': /architect|архитектор|tech lead|lead developer|разработ/,
      'Дизайн': /product designer|ui\/ux|lead designer|дизайнер/,
      'Качество': /qa|quality|code reviewer|тест/,
      'Безопасность': /security|безопас/,
      'ИИ-центр': /ai researcher|prompt|ai engineer|ии/,
      'Бизнес': /business|marketing|finance|бизнес|маркет/
    };
    if (patterns[dept]?.test(r)) s += 4;
    if (/lead|head|руковод|chief|principal|senior|архитектор/.test(r)) s += 2;
    return s;
  }

  function headFor(dept) {
    ensureV7();
    const saved = state.v7.org[dept];
    const existing = saved ? state.agents.find(a => a.id === saved) : null;
    if (existing) return existing;
    const ranked = [...state.agents].sort((a,b) => headScore(b,dept)-headScore(a,dept));
    const head = ranked.find(a => headScore(a,dept) > 0) || ranked[0];
    if (head) state.v7.org[dept] = head.id;
    return head;
  }

  function workerFor(task, dept) {
    const current = state.agents.find(a => a.id === task.agentId);
    if (current) return current;
    const query = String(task.role || task.title || '').toLowerCase();
    const head = headFor(dept);
    const candidates = state.agents.filter(a => a.id !== head?.id);
    const scored = candidates.map(a => {
      const t = roleText(a) + ' ' + depText(a) + ' ' + String(a.skills || '').toLowerCase();
      let s = depText(a).includes(dept.toLowerCase()) ? 5 : 0;
      query.split(/\s+/).filter(w => w.length > 3).forEach(w => { if (t.includes(w)) s += 2; });
      if (a.status === 'free' || a.status === 'Свободен') s += 1;
      return {a,s};
    }).sort((x,y)=>y.s-x.s);
    const worker = scored[0]?.a || current || head || state.agents[0];
    if (worker) task.agentId = worker.id;
    return worker;
  }

  function auditV7(action, details='', missionId='', level='info') {
    state.v6 = state.v6 || {audit:[]};
    state.v6.audit = Array.isArray(state.v6.audit) ? state.v6.audit : [];
    state.v6.audit.unshift({id:uid('audit'), action:'V7 · '+action, details, missionId, level, time:`${todayLabel()} ${nowLabel()}`});
    state.v6.audit = state.v6.audit.slice(0,300);
  }

  function hierarchyPlan(m) {
    ensureV7();
    planMission(m);
    m.v7Hierarchy = m.v7Hierarchy || {};
    m.tasks.forEach(t => {
      const dept = taskDepartment(t);
      const head = headFor(dept);
      const worker = workerFor(t, dept);
      t.v7 = {...(t.v7||{}), department:dept, headId:head?.id || '', workerId:worker?.id || t.agentId || '', review:t.v7?.review || 'pending'};
      if (worker) t.agentId = worker.id;
    });
    const departments = [...new Set(m.tasks.map(t=>t.v7.department))];
    m.v7Hierarchy = {
      created: m.v7Hierarchy.created || `${todayLabel()} ${nowLabel()}`,
      departments,
      heads: Object.fromEntries(departments.map(d=>[d, headFor(d)?.id || '']))
    };
    save();
    return m;
  }

  function shouldDirectorApprove(task) {
    const mode = state.v6?.settings?.approvalMode || 'critical';
    if (task.v6Approval === 'approved') return false;
    if (mode === 'none') return false;
    if (mode === 'all') return true;
    return Number(task.order) === 3 || Number(task.order) === 7 || task.v7?.department === 'Безопасность';
  }

  function askDirector(m, task) {
    state.v6.approvals = Array.isArray(state.v6.approvals) ? state.v6.approvals : [];
    if (state.v6.approvals.some(a=>a.missionId===m.id && a.taskId===task.id && a.status==='pending')) return;
    task.status='approval'; task.v6Approval='pending'; m.status='Ожидает одобрения';
    state.v6.approvals.unshift({
      id:uid('approval'), missionId:m.id, taskId:task.id, title:task.title, role:task.role,
      status:'pending', created:`${todayLabel()} ${nowLabel()}`
    });
    auditV7('Эскалация директору', `${m.title}: ${task.title}`, m.id, 'warning');
    addMemory('Запрос директору', `Руководитель отдела «${task.v7.department}» просит одобрить этап «${task.title}».`, m.projectId, headFor(task.v7.department)?.name || 'Руководитель отдела');
    save();
  }

  function makeManagerReview(m, task) {
    const dept = task.v7?.department || taskDepartment(task);
    const head = headFor(dept);
    const worker = state.agents.find(a=>a.id===(task.v7?.workerId || task.agentId));
    const result = String(task.result || task.output || task.summary || '');
    const files = Array.isArray(task.filePaths) ? task.filePaths : [];
    const checks = [
      {name:'Этап завершён исполнителем', ok:task.status==='done'},
      {name:'Нет ошибки выполнения', ok:!task.error},
      {name:'Есть передаваемый результат', ok:result.length > 20 || files.length > 0},
      {name:'Ответственный сотрудник назначен', ok:!!worker}
    ];
    const score = Math.round(checks.filter(c=>c.ok).length / checks.length * 100);
    const approved = checks[0].ok && checks[1].ok && score >= 75;
    const review = {
      id:uid('review'), missionId:m.id, taskId:task.id, department:dept,
      headId:head?.id || '', workerId:worker?.id || '', approved, score,
      checks, note: approved
        ? `Результат принят руководителем отдела «${dept}» и разрешён к передаче дальше.`
        : `Результат возвращён на доработку руководителем отдела «${dept}».`,
      time:`${todayLabel()} ${nowLabel()}`
    };
    state.v7.reviews.unshift(review);
    state.v7.reviews = state.v7.reviews.slice(0,300);
    task.v7 = {...task.v7, review:approved?'approved':'rejected', reviewId:review.id, reviewScore:score};
    auditV7(approved?'Проверка руководителя пройдена':'Руководитель вернул работу', `${m.title}: ${task.title} · ${score}%`, m.id, approved?'info':'error');
    addMemory(
      approved?'Внутренняя проверка':'Доработка',
      `${head?.name || 'Руководитель'}: ${review.note} Оценка ${score}%.`,
      m.projectId,
      head?.name || 'Руководитель отдела'
    );
    save();
    return review;
  }

  function recordHandoff(m, fromTask, toTask) {
    if (!fromTask || !toTask) return;
    const fromDept=fromTask.v7?.department||taskDepartment(fromTask);
    const toDept=toTask.v7?.department||taskDepartment(toTask);
    state.v7.handoffs.unshift({
      id:uid('handoff'), missionId:m.id, fromTaskId:fromTask.id, toTaskId:toTask.id,
      fromDept,toDept, fromHeadId:headFor(fromDept)?.id||'', toHeadId:headFor(toDept)?.id||'',
      time:`${todayLabel()} ${nowLabel()}`
    });
    state.v7.handoffs=state.v7.handoffs.slice(0,300);
    auditV7('Передача между отделами', `${fromDept} → ${toDept}: ${fromTask.title} → ${toTask.title}`, m.id);
    save();
  }

  function executiveReport(m) {
    const reviews=state.v7.reviews.filter(r=>r.missionId===m.id);
    const deps=[...new Set(m.tasks.map(t=>t.v7?.department).filter(Boolean))];
    const avg=reviews.length?Math.round(reviews.reduce((s,r)=>s+r.score,0)/reviews.length):0;
    const report={
      id:uid('report'), missionId:m.id, projectId:m.projectId, title:m.title,
      departments:deps, avgScore:avg,
      files:[...new Set(m.tasks.flatMap(t=>t.filePaths||[]))],
      completed:m.tasks.filter(t=>t.status==='done').length,
      total:m.tasks.length,
      summary:`Миссия прошла через ${deps.length} отделов. Внутренние проверки: ${reviews.filter(r=>r.approved).length}/${reviews.length}. Средняя оценка руководителей: ${avg}%.`,
      time:`${todayLabel()} ${nowLabel()}`
    };
    state.v7.reports.unshift(report); state.v7.reports=state.v7.reports.slice(0,100);
    addMemory('Отчёт руководителей', report.summary, m.projectId, 'АРГО');
    addEvent('V7: отчёт директору', `${m.title} · ${avg}% · ${deps.length} отделов`, '◆');
    return report;
  }

  function queueV7(id) {
    state.v6.queue = Array.isArray(state.v6.queue) ? state.v6.queue : [];
    state.v6.queue = state.v6.queue.filter(x=>x!==id);
    state.v6.queue.unshift(id);
    const m=state.missions.find(x=>x.id===id); if(m) m.v6Queued=true;
    save();
  }

  async function runHierarchyMission(id, all=true) {
    ensureV7();
    const m=state.missions.find(x=>x.id===id); if(!m) return;
    hierarchyPlan(m); queueV7(id);
    if(m.v6Paused){toast('Миссия на паузе');return;}
    m.engine='hierarchy'; m.status='В работе · V7'; m.pipeline={status:'running',lastRun:`${todayLabel()} ${nowLabel()}`};
    auditV7('АРГО передал миссию руководителям', `${m.title} · отделов: ${m.v7Hierarchy.departments.length}`, m.id);
    save(); render();

    let guard=0, previousDone=null;
    while(guard++<40){
      if(m.v6Paused){m.status='Пауза';break;}
      if(m.tasks.every(t=>t.status==='done' && t.v7?.review==='approved')) break;

      let task=m.tasks.find(t =>
        t.status!=='done' && !['running','approval'].includes(t.status) &&
        (t.dependsOn||[]).every(d=>{
          const dep=m.tasks.find(x=>x.id===d);
          return dep?.status==='done' && dep?.v7?.review==='approved';
        })
      );
      if(!task){
        task=m.tasks.find(t=>t.status==='done' && t.v7?.review!=='approved');
        if(task){
          const review=makeManagerReview(m,task);
          if(!review.approved){
            task.status='todo'; task.error='';
            if(state.v7.settings.stopOnManagerReject){m.status='Доработка';save();render();openMission(id);toast('Руководитель вернул этап на доработку');return;}
          }
          continue;
        }
        break;
      }

      const dept=task.v7?.department||taskDepartment(task);
      const head=headFor(dept), worker=workerFor(task,dept);
      auditV7('Руководитель назначил сотрудника', `${head?.name||'Руководитель'} → ${worker?.name||task.role}: ${task.title}`, m.id);
      addMemory('Назначение', `${head?.name||'Руководитель'} назначил ${worker?.name||'сотрудника'} на этап «${task.title}».`, m.projectId, head?.name||'Руководитель отдела');

      if(shouldDirectorApprove(task)){
        askDirector(m,task); render(); openMission(id); toast('Руководитель запросил одобрение директора'); return;
      }

      if(task.status==='error'||task.status==='blocked'){task.status='todo';task.error='';}
      task.v7.review='working';
      const ok=await executeMissionTaskAI(m,task);
      if(!ok || task.status==='error'){
        task.v7.review='failed'; m.status='Ошибка';
        auditV7('Исполнитель сообщил об ошибке', `${worker?.name||task.role}: ${task.title}`,m.id,'error');
        save();render();openMission(id);return;
      }

      const review=makeManagerReview(m,task);
      if(!review.approved){
        task.status='todo'; task.error=''; m.status='Доработка';
        save();render();openMission(id);
        if(state.v7.settings.stopOnManagerReject){toast('Руководитель вернул работу');return;}
        continue;
      }

      const next=m.tasks.find(t=>t.status!=='done' && (t.dependsOn||[]).includes(task.id));
      if(next) recordHandoff(m,task,next);
      previousDone=task;
      if(!all) break;
    }

    if(m.tasks.every(t=>t.status==='done' && t.v7?.review==='approved')){
      m.status='Завершена';m.pipeline={status:'complete',lastRun:`${todayLabel()} ${nowLabel()}`};
      state.v6.queue=(state.v6.queue||[]).filter(x=>x!==id);m.v6Queued=false;
      if(state.v7.settings.executiveReport) executiveReport(m);
      auditV7('Миссия принята всеми руководителями', m.title,m.id);
      toast('Миссия завершена и передана директору');
    }else if(!m.v6Paused && m.status!=='Ожидает одобрения' && m.status!=='Ошибка' && m.status!=='Доработка'){
      m.status='В очереди';
    }
    save();render();openMission(id);
  }

  runMissionAI = runHierarchyMission;

  function deptMembers(dept){
    const head=headFor(dept);
    let members=state.agents.filter(a=>a.id!==head?.id && (depText(a).includes(dept.toLowerCase()) || headScore(a,dept)>1));
    if(!members.length) members=state.agents.filter(a=>a.id!==head?.id).slice(0,4);
    return members.slice(0,7);
  }

  function hierarchyPage(){
    ensureV7();
    const reports=state.v7.reports.slice(0,8), reviews=state.v7.reviews.slice(0,12);
    return `<section class="card v7-hero"><div><div class="director-title">AI HQ V${V7_VERSION}</div><h3>Иерархия компании</h3><p class="meta">Вы → АРГО → руководители отделов → ИИ-сотрудники → внутренняя проверка → директор</p></div><div class="v7-flow"><span>Директор</span><i>→</i><span>АРГО</span><i>→</i><span>Руководители</span><i>→</i><span>Агенты</span></div></section>
    <div class="section-head"><h3>Руководители отделов</h3><span>${DEPTS.length}</span></div>
    <div class="v7-org">${DEPTS.map(dept=>{const h=headFor(dept),ms=deptMembers(dept);return `<article class="card v7-dept"><div class="row between"><div><div class="meta">${esc(dept)}</div><b>${esc(h?.name||'Не назначен')}</b><div class="meta">${esc(h?.role||'Руководитель отдела')}</div></div><div class="v7-head-badge">HEAD</div></div><div class="v7-team">${ms.map(a=>`<button class="v7-person" data-agent="${a.id}"><span>${initials(a.name)}</span><em>${esc(a.name)}</em><small>${esc(a.role||'Агент')}</small></button>`).join('')}</div></article>`}).join('')}</div>
    <div class="section-head"><h3>Последние проверки руководителей</h3><span>${reviews.length}</span></div>
    <div class="v7-reviews">${reviews.map(r=>{const h=state.agents.find(a=>a.id===r.headId),w=state.agents.find(a=>a.id===r.workerId),m=state.missions.find(x=>x.id===r.missionId);return `<article class="card v7-review ${r.approved?'ok':'bad'}"><div class="row between"><b>${esc(r.department)}</b><span class="v7-score">${r.score}%</span></div><div class="meta">${esc(h?.name||'Руководитель')} проверил работу ${esc(w?.name||'агента')}</div><p class="task">${esc(m?.title||'Миссия')} · ${esc(m?.tasks?.find(t=>t.id===r.taskId)?.title||'Этап')}</p><div class="v7-checks">${r.checks.map(c=>`<span class="${c.ok?'yes':'no'}">${c.ok?'✓':'×'} ${esc(c.name)}</span>`).join('')}</div></article>`}).join('')||'<div class="empty">Проверок пока нет — запустите миссию V7.</div>'}</div>
    <div class="section-head"><h3>Отчёты директору</h3><span>${reports.length}</span></div>
    <div class="v7-reports">${reports.map(r=>`<article class="card v7-report"><div class="row between"><b>${esc(r.title)}</b><span class="v7-score">${r.avgScore}%</span></div><p>${esc(r.summary)}</p><div class="meta">${r.completed}/${r.total} этапов · ${r.files.length} файлов · ${esc(r.time)}</div></article>`).join('')||'<div class="empty">Завершённых отчётов пока нет.</div>'}</div>
    <div class="section-head"><h3>Политика руководителей</h3><span>V7</span></div>
    <section class="card v7-settings"><label>Проверка результата<select id="v7ReviewMode"><option value="all" ${state.v7.settings.managerReview==='all'?'selected':''}>Каждый этап проверяет руководитель</option><option value="final" ${state.v7.settings.managerReview==='final'?'selected':''}>Только финал отдела</option></select></label><label class="v6-check"><input type="checkbox" id="v7StopReject" ${state.v7.settings.stopOnManagerReject?'checked':''}><span>Останавливать миссию при возврате на доработку</span></label><label class="v6-check"><input type="checkbox" id="v7Report" ${state.v7.settings.executiveReport?'checked':''}><span>Формировать итоговый отчёт директору</span></label></section>`;
  }

  const previousRenderPage=renderPage;
  renderPage=function(){if(state.nav==='hierarchy')return hierarchyPage();return previousRenderPage();};

  renderNav=function(){
    const nav=[['office','⌂','Офис'],['agents','◉','Агенты'],['projects','▤','Проекты'],['command','▦','Центр'],['hierarchy','⌘','Структура'],['meetings','◎','Совещания'],['studio','◇','Студия'],['director','◆','Директор']];
    return `<nav class="bottom-nav v7-nav">${nav.map(n=>`<button class="nav-btn ${state.nav===n[0]?'active':''}" data-nav="${n[0]}"><strong>${n[1]}</strong>${n[2]}</button>`).join('')}</nav>`;
  };

  const previousDirectorPage=directorPage;
  directorPage=function(){
    const base=previousDirectorPage().replace(/V6\.0/g,'V7.0');
    return `<section class="card v7-director"><div><b>Совет руководителей V7</b><p class="meta">Руководители отделов распределяют задачи, проверяют исполнителей и отчитываются вам.</p></div><button class="btn primary" data-navgo="hierarchy">Открыть структуру</button></section>${base}`;
  };

  const previousOpenMission=openMission;
  openMission=function(id){
    previousOpenMission(id);
    const m=state.missions.find(x=>x.id===id);if(!m)return;
    hierarchyPlan(m);
    const modal=$('#modal-root');
    const body=$('.modal-body',modal);
    if(body){
      const panel=document.createElement('section');panel.className='card v7-mission-panel';
      panel.innerHTML=`<div class="section-head"><h3>Цепочка руководителей</h3><span>V7</span></div><div class="v7-chain">${m.tasks.map(t=>{const h=headFor(t.v7.department),w=state.agents.find(a=>a.id===t.agentId);return `<div class="v7-chain-row"><span>${esc(t.v7.department)}</span><b>${esc(h?.name||'Руководитель')}</b><i>→</i><em>${esc(w?.name||t.role)}</em><small class="${t.v7.review==='approved'?'ok':''}">${t.v7.review==='approved'?'✓ принято':t.v7.review==='rejected'?'× доработка':'ожидает'}</small></div>`}).join('')}</div>`;
      body.prepend(panel);
    }
  };

  const previousBindGlobal=bindGlobal;
  bindGlobal=function(){
    previousBindGlobal();
    const rm=$('#v7ReviewMode');if(rm)rm.onchange=()=>{state.v7.settings.managerReview=rm.value;save();auditV7('Изменена политика проверки',rm.options[rm.selectedIndex].text)};
    const sr=$('#v7StopReject');if(sr)sr.onchange=()=>{state.v7.settings.stopOnManagerReject=sr.checked;save()};
    const er=$('#v7Report');if(er)er.onchange=()=>{state.v7.settings.executiveReport=er.checked;save()};
  };

  ensureV7();
  DEPTS.forEach(headFor);
  auditV7('Иерархия V7 активирована','Назначены руководители отделов и включена внутренняя проверка результатов');
  save();
  render();
})();