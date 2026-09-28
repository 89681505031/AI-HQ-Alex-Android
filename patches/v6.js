/* AI HQ V6 — Command Center */
(() => {
  const V6_VERSION = '6.0';
  const criticalOrders = new Set([3, 7]);

  function ensureV6() {
    state.v6 = state.v6 || {};
    state.v6.queue = Array.isArray(state.v6.queue) ? state.v6.queue : [];
    state.v6.audit = Array.isArray(state.v6.audit) ? state.v6.audit : [];
    state.v6.approvals = Array.isArray(state.v6.approvals) ? state.v6.approvals : [];
    state.v6.settings = {
      approvalMode: 'critical',
      autoRetry: 1,
      autoResumeAfterApproval: true,
      ...state.v6.settings
    };
    state.missions.forEach(m => {
      m.v6Paused = !!m.v6Paused;
      m.v6Queued = !!m.v6Queued;
      (m.tasks || []).forEach(t => {
        t.v6Attempts = Number(t.v6Attempts || 0);
        t.v6Approval = t.v6Approval || '';
      });
    });
    state.v6.queue = state.v6.queue.filter(id => state.missions.some(m => m.id === id));
    save();
  }

  function v6Audit(action, details = '', missionId = '', level = 'info') {
    ensureV6();
    state.v6.audit.unshift({
      id: uid('audit'), action, details, missionId, level,
      time: `${todayLabel()} ${nowLabel()}`
    });
    state.v6.audit = state.v6.audit.slice(0, 250);
  }

  ensureV6();

  const baseAddEvent = addEvent;
  addEvent = function(title, text, icon = '•') {
    baseAddEvent(title, text, icon);
    v6Audit(title, text, '', icon === '!' ? 'error' : 'info');
    save();
  };

  function missionById(id) { return state.missions.find(m => m.id === id); }

  function priorityWeight(p) {
    return p === 'Высокий' ? 3 : p === 'Средний' ? 2 : 1;
  }

  function queueMission(id, front = false) {
    ensureV6();
    const m = missionById(id);
    if (!m) return;
    state.v6.queue = state.v6.queue.filter(x => x !== id);
    if (front) state.v6.queue.unshift(id); else state.v6.queue.push(id);
    m.v6Queued = true;
    if (m.status !== 'Завершена' && !m.v6Paused) m.status = 'В очереди';
    v6Audit('Миссия добавлена в очередь', m.title, id);
    save();
  }

  function dequeueMission(id) {
    const m = missionById(id);
    state.v6.queue = state.v6.queue.filter(x => x !== id);
    if (m) m.v6Queued = false;
    save();
  }

  function sortQueueByPriority() {
    state.v6.queue.sort((a, b) => priorityWeight(missionById(b)?.priority) - priorityWeight(missionById(a)?.priority));
    save();
  }

  function pauseMissionV6(id) {
    const m = missionById(id); if (!m) return;
    m.v6Paused = true;
    m.status = 'Пауза';
    if (m.pipeline) m.pipeline.status = 'paused';
    v6Audit('Миссия приостановлена', m.title, id, 'warning');
    addMemory('Решение директора', `Миссия «${m.title}» приостановлена.`, m.projectId, 'Алекс');
    save(); render(); toast('Миссия поставлена на паузу');
  }

  function resumeMissionV6(id) {
    const m = missionById(id); if (!m) return;
    m.v6Paused = false;
    if (m.status !== 'Завершена') m.status = m.v6Queued ? 'В очереди' : 'Планируется';
    if (m.pipeline?.status === 'paused') m.pipeline.status = 'idle';
    v6Audit('Миссия возобновлена', m.title, id);
    save(); render(); toast('Миссия возобновлена');
  }

  function approvalRequired(m, task) {
    const mode = state.v6.settings.approvalMode;
    if (mode === 'none') return false;
    if (task.v6Approval === 'approved') return false;
    if (mode === 'all') return true;
    return criticalOrders.has(Number(task.order)) || /Security|безопас|архитектор/i.test(task.role || '');
  }

  function existingApproval(missionId, taskId) {
    return state.v6.approvals.find(a => a.missionId === missionId && a.taskId === taskId && a.status === 'pending');
  }

  function requestApproval(m, task) {
    if (existingApproval(m.id, task.id)) return;
    task.status = 'approval';
    task.v6Approval = 'pending';
    m.status = 'Ожидает одобрения';
    m.pipeline = {...(m.pipeline || {}), status:'approval', currentTaskId:task.id, lastRun:`${todayLabel()} ${nowLabel()}`};
    state.v6.approvals.unshift({
      id: uid('approval'), missionId:m.id, taskId:task.id,
      title:task.title, role:task.role, status:'pending',
      created:`${todayLabel()} ${nowLabel()}`
    });
    v6Audit('Запрошено одобрение директора', `${m.title}: ${task.title}`, m.id, 'warning');
    addMemory('Запрос на одобрение', `Этап «${task.title}» миссии «${m.title}» ожидает решения директора.`, m.projectId, 'АРГО');
    save();
  }

  function approveStep(approvalId) {
    const a = state.v6.approvals.find(x => x.id === approvalId); if (!a) return;
    const m = missionById(a.missionId), task = m?.tasks?.find(t => t.id === a.taskId); if (!m || !task) return;
    a.status = 'approved'; a.decided = `${todayLabel()} ${nowLabel()}`;
    task.v6Approval = 'approved'; task.status = 'todo'; task.error = '';
    m.status = m.v6Paused ? 'Пауза' : 'В очереди';
    v6Audit('Директор одобрил этап', `${m.title}: ${task.title}`, m.id);
    addMemory('Одобрение директора', `Этап «${task.title}» одобрен.`, m.projectId, 'Алекс');
    save(); render(); toast('Этап одобрен');
    if (state.v6.settings.autoResumeAfterApproval && !m.v6Paused) setTimeout(() => runMissionAI(m.id, true), 120);
  }

  function rejectStep(approvalId) {
    const a = state.v6.approvals.find(x => x.id === approvalId); if (!a) return;
    const m = missionById(a.missionId), task = m?.tasks?.find(t => t.id === a.taskId); if (!m || !task) return;
    a.status = 'rejected'; a.decided = `${todayLabel()} ${nowLabel()}`;
    task.v6Approval = 'rejected'; task.status = 'blocked';
    m.status = 'Остановлена директором'; m.v6Paused = true;
    v6Audit('Директор отклонил этап', `${m.title}: ${task.title}`, m.id, 'warning');
    addMemory('Решение директора', `Этап «${task.title}» отклонён. Миссия остановлена.`, m.projectId, 'Алекс');
    save(); render(); toast('Этап отклонён, миссия остановлена');
  }

  async function executeWithRetry(m, task) {
    const maxRetry = Math.max(0, Math.min(3, Number(state.v6.settings.autoRetry || 0)));
    let attempt = 0;
    while (attempt <= maxRetry) {
      if (m.v6Paused) return false;
      task.v6Attempts = Number(task.v6Attempts || 0) + 1;
      try {
        v6Audit('Запуск этапа', `${m.title}: ${task.title} · попытка ${task.v6Attempts}`, m.id);
        const ok = await executeMissionTaskAI(m, task);
        if (ok) return true;
        return false;
      } catch (e) {
        attempt++;
        if (attempt > maxRetry) {
          v6Audit('Этап завершился ошибкой', `${m.title}: ${task.title} — ${String(e.message || e).slice(0,140)}`, m.id, 'error');
          return false;
        }
        task.status = 'todo'; task.error = '';
        v6Audit('Автоповтор этапа', `${m.title}: ${task.title} · повтор ${attempt}/${maxRetry}`, m.id, 'warning');
        save();
      }
    }
    return false;
  }

  runMissionAI = async function(id, all = true) {
    ensureV6();
    const m = missionById(id); if (!m) return;
    planMission(m);
    queueMission(id, true);
    if (m.v6Paused) { toast('Миссия на паузе'); return; }
    m.engine = 'ai'; m.status = 'В работе · ИИ';
    m.pipeline = {status:'running', lastRun:`${todayLabel()} ${nowLabel()}`};
    save(); render();
    toast(all ? 'Командный центр запустил миссию' : 'Запускаю следующий этап');
    try {
      let guard = 0;
      while (guard++ < 30) {
        if (m.v6Paused) { m.status = 'Пауза'; break; }
        const pending = m.tasks.filter(t => t.status !== 'done');
        if (!pending.length) break;
        const task = m.tasks.find(t => !['done','running','blocked','approval'].includes(t.status) && (t.dependsOn || []).every(d => m.tasks.find(x => x.id === d)?.status === 'done')) ||
                     m.tasks.find(t => t.status === 'error' && (t.dependsOn || []).every(d => m.tasks.find(x => x.id === d)?.status === 'done'));
        if (!task) break;
        if (approvalRequired(m, task)) {
          requestApproval(m, task); render(); openMission(id); toast('Требуется одобрение директора'); return;
        }
        if (task.status === 'error') { task.status = 'todo'; task.error = ''; }
        const ok = await executeWithRetry(m, task);
        if (!ok) {
          if (task.status === 'error') m.status = 'Ошибка';
          break;
        }
        if (!all) break;
      }
      if (m.tasks.every(t => t.status === 'done')) {
        m.status = 'Завершена'; m.pipeline = {status:'complete', lastRun:`${todayLabel()} ${nowLabel()}`};
        dequeueMission(id);
        const files = [...new Set(m.tasks.flatMap(t => t.filePaths || []))];
        addMemory('Решение', `ИИ-миссия «${m.title}» завершена под контролем V6. ${m.tasks.length} этапов, ${files.length} файлов.`, m.projectId, 'АРГО');
        addEvent('V6: миссия завершена', `${m.title} · ${files.length} файлов`, '◆');
      } else if (!m.v6Paused && m.status !== 'Ожидает одобрения' && m.status !== 'Ошибка') {
        m.status = 'В очереди';
      }
      save(); render(); openMission(id);
    } catch (e) {
      m.status = 'Ошибка'; save(); render(); openMission(id);
      toast('Конвейер остановлен: ' + String(e.message || e).slice(0, 140));
    }
  };

  async function runNextQueuedMission() {
    sortQueueByPriority();
    const id = state.v6.queue.find(id => {
      const m = missionById(id);
      return m && m.status !== 'Завершена' && !m.v6Paused;
    });
    if (!id) return toast('Очередь миссий пуста');
    await runMissionAI(id, true);
  }

  function retryMission(id) {
    const m = missionById(id); if (!m) return;
    const t = m.tasks.find(t => t.status === 'error' || t.status === 'blocked');
    if (t) { t.status = 'todo'; t.error = ''; if (t.v6Approval === 'rejected') t.v6Approval = ''; }
    m.v6Paused = false; m.status = 'В очереди'; queueMission(id, true);
    v6Audit('Ручной повтор миссии', m.title, id);
    save(); render(); setTimeout(() => runMissionAI(id, true), 120);
  }

  function commandCenterPage() {
    ensureV6();
    const active = state.missions.filter(m => m.status !== 'Завершена');
    const busy = state.agents.filter(a => ['busy','meeting','director'].includes(a.status));
    const pendingApprovals = state.v6.approvals.filter(a => a.status === 'pending');
    const errors = state.missions.filter(m => m.status === 'Ошибка' || (m.tasks || []).some(t => t.status === 'error')).length;
    const queued = state.v6.queue.map(missionById).filter(Boolean);
    return `<section class="card v6-hero"><div><div class="director-title">AI HQ V${V6_VERSION}</div><h3>Командный центр</h3><p class="meta">Директор → АРГО → очередь → агенты → контроль → результат</p></div><div class="v6-live"><span class="v6-pulse"></span> Система активна</div><div class="hero-actions"><button class="btn primary" data-v6-run-next>▶ Запустить следующую миссию</button><button class="btn" data-new-mission>＋ Новая миссия</button><button class="btn" data-v6-sort>Приоритетная очередь</button></div></section>
    <div class="stats v6-stats"><div class="stat"><b>${active.length}</b><span>Активные миссии</span></div><div class="stat"><b>${queued.length}</b><span>В очереди</span></div><div class="stat"><b>${pendingApprovals.length}</b><span>Ждут директора</span></div><div class="stat"><b>${busy.length}</b><span>Агенты заняты</span></div></div>
    ${errors ? `<div class="v6-alert"><b>Есть остановленные этапы: ${errors}</b><span>Откройте миссию или нажмите «Повторить».</span></div>` : ''}
    <div class="section-head"><h3>Очередь миссий</h3><span>${queued.length}</span></div>
    <div class="v6-queue">${(queued.length ? queued : active).map((m, i) => {
      const done=(m.tasks||[]).filter(t=>t.status==='done').length,total=(m.tasks||[]).length||7;
      const err=(m.tasks||[]).some(t=>t.status==='error'||t.status==='blocked');
      return `<article class="card v6-mission"><div class="row between"><div><span class="v6-index">${i+1}</span><b>${esc(m.title)}</b><div class="meta">${esc(project(m.projectId)?.name||'Без проекта')} · ${esc(m.priority)}</div></div><span class="status ${m.v6Paused?'meeting':err?'busy':'free'}">${esc(m.status)}</span></div><div class="progress"><i style="width:${Math.round(done/total*100)}%"></i></div><div class="row between"><span class="meta">${done}/${total} этапов</span><span class="meta">${(m.tasks||[]).reduce((n,t)=>n+(t.v6Attempts||0),0)} запусков</span></div><div class="v6-actions"><button class="btn mini" data-mission="${m.id}">Открыть</button>${m.v6Paused?`<button class="btn mini" data-v6-resume="${m.id}">Возобновить</button>`:`<button class="btn mini" data-v6-pause="${m.id}">Пауза</button>`}${err?`<button class="btn mini warn" data-v6-retry="${m.id}">Повторить</button>`:''}<button class="btn mini" data-v6-run="${m.id}">Запустить</button></div></article>`;
    }).join('') || `<div class="empty">Активных миссий нет</div>`}</div>
    <div class="section-head"><h3>Одобрения директора</h3><span>${pendingApprovals.length}</span></div>
    <div class="v6-approvals">${pendingApprovals.map(a=>{const m=missionById(a.missionId);return `<article class="card v6-approval"><div class="v6-approval-icon">!</div><div><b>${esc(a.title)}</b><div class="meta">${esc(m?.title||'Миссия')} · ${esc(a.role)}</div><p class="task">АРГО остановил конвейер перед критическим этапом и ждёт вашего решения.</p><div class="v6-actions"><button class="btn primary mini" data-v6-approve="${a.id}">Одобрить</button><button class="btn mini danger" data-v6-reject="${a.id}">Отклонить</button><button class="btn mini" data-mission="${a.missionId}">Подробнее</button></div></div></article>`}).join('')||`<div class="empty">Сейчас решений директора не требуется</div>`}</div>
    <div class="section-head"><h3>Настройки автономности</h3><span>V6 policy</span></div>
    <section class="card v6-settings"><label>Одобрение директора<select id="v6ApprovalMode"><option value="critical" ${state.v6.settings.approvalMode==='critical'?'selected':''}>Перед критическими этапами</option><option value="all" ${state.v6.settings.approvalMode==='all'?'selected':''}>Перед каждым этапом</option><option value="none" ${state.v6.settings.approvalMode==='none'?'selected':''}>Полный автопилот без пауз</option></select></label><label>Автоповтор при ошибке<select id="v6Retry"><option value="0" ${state.v6.settings.autoRetry==0?'selected':''}>Не повторять</option><option value="1" ${state.v6.settings.autoRetry==1?'selected':''}>1 повтор</option><option value="2" ${state.v6.settings.autoRetry==2?'selected':''}>2 повтора</option><option value="3" ${state.v6.settings.autoRetry==3?'selected':''}>3 повтора</option></select></label><label class="v6-check"><input type="checkbox" id="v6AutoResume" ${state.v6.settings.autoResumeAfterApproval?'checked':''}><span>Автоматически продолжать после одобрения</span></label></section>
    <div class="section-head"><h3>Журнал действий</h3><span>${state.v6.audit.length}</span></div>
    <div class="v6-audit">${state.v6.audit.slice(0,40).map(x=>`<div class="v6-audit-row ${x.level}"><div class="v6-audit-dot"></div><div><b>${esc(x.action)}</b><p>${esc(x.details)}</p></div><time>${esc(x.time)}</time></div>`).join('')||`<div class="empty">Журнал пока пуст</div>`}</div>`;
  }

  const baseRenderPage = renderPage;
  renderPage = function() {
    if (state.nav === 'command') return commandCenterPage();
    return baseRenderPage();
  };

  renderNav = function() {
    const nav=[['office','⌂','Офис'],['agents','◉','Агенты'],['projects','▤','Проекты'],['command','▦','Центр'],['meetings','◎','Совещания'],['studio','⌘','Студия'],['director','◆','Директор']];
    return `<nav class="bottom-nav v6-nav">${nav.map(n=>`<button class="nav-btn ${state.nav===n[0]?'active':''}" data-nav="${n[0]}"><strong>${n[1]}</strong>${n[2]}</button>`).join('')}</nav>`;
  };

  const baseDirectorPage = directorPage;
  directorPage = function() {
    let html = baseDirectorPage().replace('V5.0', `V${V6_VERSION}`);
    return `<section class="card v6-director-link"><div><b>Командный центр V${V6_VERSION}</b><p class="meta">Очередь миссий, одобрения, повторы и журнал автономных действий.</p></div><button class="btn primary" data-navgo="command">Открыть центр</button></section>${html}`;
  };

  const baseMissionPanel = missionPanel;
  missionPanel = function() {
    const approvals = state.v6.approvals.filter(a=>a.status==='pending').length;
    return `${approvals?`<div class="v6-inline-alert">Директору требуется принять решений: <b>${approvals}</b> <button class="btn mini" data-navgo="command">Открыть</button></div>`:''}${baseMissionPanel()}`;
  };

  const baseBindGlobal = bindGlobal;
  bindGlobal = function() {
    baseBindGlobal();
    $$('[data-v6-run-next]').forEach(b=>b.onclick=runNextQueuedMission);
    $$('[data-v6-sort]').forEach(b=>b.onclick=()=>{sortQueueByPriority();render();toast('Очередь отсортирована по приоритету')});
    $$('[data-v6-pause]').forEach(b=>b.onclick=()=>pauseMissionV6(b.dataset.v6Pause));
    $$('[data-v6-resume]').forEach(b=>b.onclick=()=>resumeMissionV6(b.dataset.v6Resume));
    $$('[data-v6-retry]').forEach(b=>b.onclick=()=>retryMission(b.dataset.v6Retry));
    $$('[data-v6-run]').forEach(b=>b.onclick=()=>{queueMission(b.dataset.v6Run,true);runMissionAI(b.dataset.v6Run,true)});
    $$('[data-v6-approve]').forEach(b=>b.onclick=()=>approveStep(b.dataset.v6Approve));
    $$('[data-v6-reject]').forEach(b=>b.onclick=()=>rejectStep(b.dataset.v6Reject));
    const am=$('#v6ApprovalMode'); if(am) am.onchange=()=>{state.v6.settings.approvalMode=am.value;save();v6Audit('Изменена политика одобрения',am.options[am.selectedIndex].text)};
    const rr=$('#v6Retry'); if(rr) rr.onchange=()=>{state.v6.settings.autoRetry=Number(rr.value);save();v6Audit('Изменена политика повтора',`Автоповторов: ${rr.value}`)};
    const ar=$('#v6AutoResume'); if(ar) ar.onchange=()=>{state.v6.settings.autoResumeAfterApproval=ar.checked;save()};
  };

  const baseOpenMission = openMission;
  openMission = function(id) {
    baseOpenMission(id);
    const m = missionById(id); if (!m) return;
    const actions = $('.hero-actions', $('#modal-root'));
    if (actions) {
      const pause = document.createElement('button');
      pause.className='btn'; pause.textContent=m.v6Paused?'Возобновить V6':'Пауза V6';
      pause.onclick=()=>m.v6Paused?resumeMissionV6(id):pauseMissionV6(id);
      actions.appendChild(pause);
      if ((m.tasks||[]).some(t=>t.status==='error'||t.status==='blocked')) {
        const retry=document.createElement('button');retry.className='btn';retry.textContent='Повторить ошибку';retry.onclick=()=>retryMission(id);actions.appendChild(retry);
      }
    }
  };

  state.missions.filter(m=>m.status!=='Завершена').forEach(m=>{ if(!state.v6.queue.includes(m.id)) state.v6.queue.push(m.id); m.v6Queued=true; });
  v6Audit('AI HQ V6 активирован', 'Командный центр, очередь, одобрения директора, повторы и журнал действий');
  save();
  render();
})();