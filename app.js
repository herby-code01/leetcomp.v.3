(() => {
  'use strict';
  const DATA = window.LEETCOMP_DATA;
  const DB_NAME = 'leetcomp-pages-sqlite';
  const SESSION_KEY = 'leetcomp-pages-user';
  const $ = (id) => document.getElementById(id);
  const sb = window.LEETCOMP_CONFIG && !window.LEETCOMP_CONFIG.supabaseUrl?.includes('YOUR_') && !window.LEETCOMP_CONFIG.supabaseAnonKey?.includes('YOUR_') && window.supabase?.createClient(
    window.LEETCOMP_CONFIG.supabaseUrl, window.LEETCOMP_CONFIG.supabaseAnonKey
  );
  let SQL, database, currentUser = null, selectedTopic = DATA.topics[0].id, selectedProblem = null;
  let boardOffset = 0, observedUtcDay = dayString();
  let attemptId = null, attemptDeadline = null, sharedAttemptId = null, sharedBoardError = null, timerHandle = null, saveHandle = null;
  let editor = null, judgeWorker = null, judgeJob = 0, pendingJobs = new Map();
  let judgeBusy = false, pendingFinish = false, submitting = false, finished = false, authMode = 'login';

  function idbOpen() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('sqlite');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  let idbPromise;
  function idb() { return idbPromise ||= idbOpen(); }
  async function loadSavedFile() {
    const store = (await idb()).transaction('sqlite', 'readonly').objectStore('sqlite');
    return new Promise((resolve, reject) => {
      const request = store.get('database');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }
  async function saveDatabase() {
    const bytes = database.export();
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const tx = (await idb()).transaction('sqlite', 'readwrite');
    tx.objectStore('sqlite').put(buffer, 'database');
    return new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  }
  function rows(sql, params = []) {
    const stmt = database.prepare(sql); stmt.bind(params); const result = [];
    while (stmt.step()) result.push(stmt.getAsObject());
    stmt.free(); return result;
  }
  function row(sql, params = []) { return rows(sql, params)[0] || null; }
  function sqlRun(sql, params = []) { database.run(sql, params); }
  const persistQueue = { task: Promise.resolve() };
  function persist() { persistQueue.task = persistQueue.task.catch(() => {}).then(saveDatabase); return persistQueue.task; }

  async function initDatabase() {
    if (!window.initSqlJs) throw new Error('The SQLite library could not load. Check your connection and reload.');
    SQL = await initSqlJs({ locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.15.2/${file}` });
    const saved = await loadSavedFile();
    database = saved ? new SQL.Database(new Uint8Array(saved)) : new SQL.Database();
    database.run(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attempts (
        id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
        day TEXT NOT NULL, topic TEXT NOT NULL, problem_id TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'live', code TEXT NOT NULL DEFAULT '',
        started_at INTEGER NOT NULL, deadline_at INTEGER NOT NULL, submitted_at INTEGER,
        accepted INTEGER, passed INTEGER, total INTEGER, runtime_ms REAL, memory_mb REAL,
        verdict TEXT, error TEXT,
        UNIQUE(user_id, day, topic)
      );
      CREATE INDEX IF NOT EXISTS ix_attempts_day_topic ON attempts(day, topic);
      CREATE INDEX IF NOT EXISTS ix_attempts_user ON attempts(user_id, day);
    `);
    await persist();
  }
  const enc = new TextEncoder();
  function bytesHex(buf) { return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join(''); }
  async function passwordHash(password, salt) {
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 120000, hash: 'SHA-256' }, key, 256);
    return bytesHex(bits);
  }
  function safeText(el, value) { el.textContent = value == null ? '' : String(value); }
  const THEMES = new Set(['midnight','slate','arctic','violet']);
  function applyTheme(theme = localStorage.getItem('leetcomp-theme') || 'midnight') {
    if (!THEMES.has(theme)) theme = 'midnight';
    document.documentElement.dataset.theme = theme;
    const select = $('themeSelect'); if (select) select.value = theme;
  }
  function renderSettings() {
    if (!currentUser) return;
    $('settingsEmail').value = currentUser.email || '';
    $('settingsDisplayName').value = currentUser.displayName || currentUser.username;
    applyTheme();
  }
  async function saveProfile() {
    const displayName = $('settingsDisplayName').value.trim();
    if (!displayName || displayName.length > 60) { safeText($('profileMessage'), 'Display name must be 1 to 60 characters.'); return; }
    $('saveProfile').disabled = true;
    try {
      const { data, error } = await sb.auth.updateUser({ data: { ...currentUser.userMetadata, display_name: displayName } });
      if (error) throw error;
      const { error: profileError } = await sb.from('profiles').update({ display_name: displayName, updated_at: new Date().toISOString() }).eq('id', currentUser.authUid);
      if (profileError) throw profileError;
      currentUser.displayName = displayName; currentUser.userMetadata = data.user.user_metadata;
      $('userName').textContent = displayName; safeText($('profileMessage'), 'Profile saved.');
    } catch (error) { safeText($('profileMessage'), error.message || 'Could not save profile.'); }
    finally { $('saveProfile').disabled = false; }
  }
  async function sendPasswordRecovery() {
    const email = $('loginEmail').value.trim();
    safeText($('authMessage'), '');
    if (!email) { safeText($('authMessage'), 'Enter your account email first.'); $('loginEmail').focus(); return; }
    $('forgotPassword').disabled = true;
    try {
      const redirectTo = new URL('./', window.location.href).href;
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      safeText($('authMessage'), 'If an account matches that address, a password reset email is on its way.');
    } catch (error) { safeText($('authMessage'), error.message || 'Could not send the reset email.'); }
    finally { $('forgotPassword').disabled = false; }
  }
  async function submitPasswordRecovery(event) {
    event.preventDefault(); safeText($('recoveryMessage'), '');
    const password = $('newPassword').value;
    if (password.length < 8) { safeText($('recoveryMessage'), 'Use a password with at least 8 characters.'); return; }
    const { error } = await sb.auth.updateUser({ password });
    if (error) { safeText($('recoveryMessage'), error.message); return; }
    await sb.auth.signOut();
    history.replaceState(null, '', new URL('./', location.href).pathname);
    $('recoveryView').hidden = true; $('authView').hidden = false; setAuthMode('login');
    safeText($('authMessage'), 'Password updated. Sign in with your new password.');
  }
  function dayString(d = new Date()) { return d.toISOString().slice(0, 10); }
  function dayOrdinal() { const [y,m,d] = dayString().split('-').map(Number); return Math.floor(Date.UTC(y,m-1,d) / 86400000); }
  function todayProblem(topic) {
    const pool = DATA.problems.filter(p => p.topic === topic), i = DATA.topics.findIndex(t => t.id === topic);
    return pool[((dayOrdinal() + 3*i) % pool.length + pool.length) % pool.length];
  }
  function minutes(problem) { return DATA.minutes[problem.difficulty] || 30; }
  function codeStarter(p) { return `class Solution:\n    def ${p.method}(self${p.params.length ? ', ' + p.params.join(', ') : ''}):\n        # Write your solution here\n        pass\n`; }
  function escapeHTML(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  function setAuthMode(mode) {
    authMode = mode;
    $('showLogin').classList.toggle('active', mode === 'login'); $('showSignup').classList.toggle('active', mode === 'signup');
    $('authSubmit').textContent = mode === 'login' ? 'Sign in' : 'Create account';
    $('password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    $('forgotPassword').hidden = mode === 'signup';
    document.querySelectorAll('.signup-only').forEach(el => el.hidden = mode !== 'signup');
    document.querySelectorAll('.login-only').forEach(el => el.hidden = mode === 'signup');
    $('loginEmail').required = mode === 'login'; $('email').required = mode === 'signup'; $('username').required = mode === 'signup';
    safeText($('authMessage'), '');
  }
  async function syncLocalUser(authUser) {
    const metadata = authUser.user_metadata || {};
    const username = metadata.username || authUser.email.split('@')[0].replace(/[^A-Za-z0-9_]/g, '').slice(0, 20) || 'coder';
    const displayName = metadata.display_name || username;
    const { error: profileError } = await sb.from('profiles').upsert({ id: authUser.id, email: authUser.email, username, display_name: displayName }, { onConflict: 'id' });
    if (profileError) throw new Error('Your account is signed in, but its profile could not be saved: ' + profileError.message);
    let user = row('SELECT id,username FROM users WHERE username=?', [username]);
    if (!user) {
      const salt = bytesHex(crypto.getRandomValues(new Uint8Array(16)));
      sqlRun('INSERT INTO users(username,salt,password_hash,created_at) VALUES(?,?,?,?)', [username, salt, 'supabase-auth', new Date().toISOString()]);
      await persist(); user = row('SELECT id,username FROM users WHERE username=?', [username]);
    }
    currentUser = { ...user, authUid: authUser.id, email: authUser.email, displayName, userMetadata: metadata };
    $('userName').textContent = displayName;
    renderSettings();
  }
  async function authSubmit(event) {
    event.preventDefault(); safeText($('authMessage'), ''); $('authSubmit').disabled = true;
    try {
      if (!sb) throw new Error('Sign-in is not configured yet. Add your Supabase project URL and public key to config.js.');
      const password = $('password').value;
      const email = authMode === 'login' ? $('loginEmail').value.trim() : $('email').value.trim();
      const username = $('username').value.trim();
      if (password.length < 8) throw new Error('Use a password with at least 8 characters.');
      if (authMode === 'signup') {
        if (username.length < 3 || username.length > 20) throw new Error('Username must be 3 to 20 characters.');
        if (!/^[A-Za-z0-9_]+$/.test(username)) throw new Error('Use letters, numbers, or underscores for your username.');
        const emailRedirectTo = new URL("./", window.location.href).href;
        const displayName = $('displayName').value.trim() || username;
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { username, display_name: displayName }, emailRedirectTo } });
        if (error) throw error;
        if (!data.session) { safeText($('authMessage'), 'Account created. Sign in to continue. If confirmation is still enabled, use the email link first.'); return; }
        await syncLocalUser(data.user);
      } else {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await syncLocalUser(data.user);
      }
      localStorage.setItem(SESSION_KEY, String(currentUser.id)); $('authView').hidden = true; $('appView').hidden = false; $('signOut').hidden = false;
      renderHome(); await resumeRace();
    } catch (error) { safeText($('authMessage'), error.message || 'Could not sign in.'); }
    finally { $('authSubmit').disabled = false; }
  }
  async function signOut() { await sb?.auth.signOut(); currentUser = null; localStorage.removeItem(SESSION_KEY); $('appView').hidden = true; $('arenaView').hidden = true; $('authView').hidden = false; $('signOut').hidden = true; safeText($('userName'), ''); }
  async function restoreSession() {
    if (!sb) return;
    const { data } = await sb.auth.getSession();
    const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
    const isPasswordRecovery = new URLSearchParams(location.search).get('password-reset') === '1' || hashParams.get('type') === 'recovery';
    if (isPasswordRecovery && data.session?.user) { $('authView').hidden = true; $('recoveryView').hidden = false; return; }
    if (data.session?.user) {
      await syncLocalUser(data.session.user); $('authView').hidden = true; $('appView').hidden = false; $('signOut').hidden = false;
      renderHome(); await resumeRace();
    }
  }

  function renderTopics() {
    $('topics').innerHTML = DATA.topics.map(t => {
      const count = DATA.problems.filter(p => p.topic === t.id).length;
      return `<button class="topic ${t.id === selectedTopic ? 'active' : ''}" data-topic="${escapeHTML(t.id)}"><b>${escapeHTML(t.name)}</b><small>${count} PROBLEMS</small></button>`;
    }).join('');
  }
  function attemptFor(day, topic) { return row('SELECT * FROM attempts WHERE user_id=? AND day=? AND topic=?', [currentUser.id,day,topic]); }
  function showExamples(problem, target) {
    target.innerHTML = problem.cases.slice(0, Math.min(2, problem.simpleCount)).map((c,i) =>
      `<div class="example"><b>EXAMPLE ${i+1}</b><code>Input: ${escapeHTML(JSON.stringify(c.args))}\nOutput: ${escapeHTML(JSON.stringify(c.expected))}</code></div>`).join('');
  }
  function chooseProblem() {
    selectedProblem = todayProblem(selectedTopic);
    safeText($('problemTitle'), selectedProblem.title); safeText($('problemBlurb'), selectedProblem.blurb);
    const d = $('difficulty'); d.textContent = selectedProblem.difficulty; d.className = 'difficulty ' + selectedProblem.difficulty.toLowerCase();
    $('problemMeta').textContent = `LeetCode #${selectedProblem.number} · ${DATA.topics.find(t=>t.id===selectedTopic).name} · ${minutes(selectedProblem)} minutes`;
    $('complexity').textContent = `Target ${selectedProblem.bestTime} time / ${selectedProblem.bestSpace} space`;
    $('fullProblem').href = selectedProblem.url; showExamples(selectedProblem, $('examples'));
    const old = attemptFor(dayString(),selectedTopic);
    $('enterArena').disabled = !!old && old.state === 'done';
    $('enterArena').textContent = old ? (old.state === 'live' ? 'Return to lockdown' : 'Race completed today') : 'Enter lockdown';
    renderTopics(); renderBoard();
  }
  async function renderBoard(day = new Date(Date.now()-boardOffset*86400000).toISOString().slice(0,10), topic = selectedTopic) {
    if (!sb || !currentUser?.authUid) { $('leaderboard').innerHTML='<div class="empty">Sign in to view shared standings.</div>'; return []; }
    $('leaderboard').setAttribute('aria-busy','true');
    const {data,error}=await sb.rpc('get_topic_leaderboard',{p_day:day,p_topic:topic});
    $('leaderboard').removeAttribute('aria-busy');
    if(error){$('leaderboard').innerHTML='<div class="empty">Shared standings are unavailable. Apply the competition SQL setup and refresh.</div>';return [];}
    const list=data||[];
    $('leaderboard').innerHTML = list.length ? list.slice(0,10).map(r=>`<div class="board-row ${r.rank===1?'leader':''}"><span>${r.rank ? String(r.rank).padStart(2,'0') : '—'}</span><span>${escapeHTML(r.username)}<small>${r.accepted?`Time ${Number(r.time_pct).toFixed(1)}% · Space ${Number(r.space_pct).toFixed(1)}%`:(r.state==='live'?'In the arena':escapeHTML(r.verdict||'Not accepted'))}</small></span><span>${r.score==null?'—':Number(r.score).toFixed(1)+' pts'}</span></div>`).join('') : '<div class="empty">No entries yet. Start today’s race.</div>';
    const past=day<dayString();
    $('boardStatus').textContent=past?'FINAL RESULTS':'LIVE · UPDATES AS PLAYERS SUBMIT';
    $('boardDayToggle').textContent=boardOffset?'View today’s live board':'View yesterday’s final';
    return list;
  }
  async function totalWins() { if(!sb||!currentUser?.authUid)return 0;const {data,error}=await sb.rpc('get_my_competition_wins');return error?0:Number(data)||0; }
  async function renderDashboard() {
    const all=rows('SELECT a.*,u.username FROM attempts a JOIN users u ON u.id=a.user_id WHERE a.user_id=? ORDER BY a.day DESC,a.id DESC LIMIT 30',[currentUser.id]);
    const accepted=all.filter(a=>a.accepted===1).length,wins=await totalWins();
    $('winTotal').textContent=wins;$('dashWins').textContent=wins;$('dashRaces').textContent=all.length;$('dashAccepted').textContent=accepted;
    const recent=all.slice(0,8),keys=[...new Set(recent.map(a=>`${a.day}|${a.topic}`))],shared=new Map();
    await Promise.all(keys.map(async key=>{const [day,topic]=key.split('|');const {data,error}=await sb.rpc('get_topic_leaderboard',{p_day:day,p_topic:topic});if(!error)shared.set(key,data||[]);}));
    $('history').innerHTML=recent.length?recent.map(a=>{const p=DATA.problems.find(x=>x.id===a.problem_id),board=shared.get(`${a.day}|${a.topic}`)||[],rank=board.find(x=>x.user_id===currentUser.authUid);return `<div class="history-row"><span>${a.accepted===1?(rank&&rank.rank===1&&a.day<dayString()?'🏆':'✓'):'·'}</span><span>${escapeHTML(p?p.title:a.problem_id)}<small>${escapeHTML(a.day)} · ${escapeHTML(DATA.topics.find(t=>t.id===a.topic)?.name||a.topic)} · ${escapeHTML(a.verdict||'In progress')}</small></span><b>${rank&&rank.rank?`#${rank.rank}`:'—'}</b></div>`}).join(''):'<div class="empty">Your completed races will appear here.</div>';
    const {data:latestWin}=await sb.rpc('get_my_latest_win');
    if(latestWin?.length){const win=latestWin[0],topicName=DATA.topics.find(t=>t.id===win.topic)?.name||win.topic;$('winNotice').textContent=`🏆 You won ${topicName} on ${win.competition_day}. Final standings are in the shared board.`;$('winNotice').hidden=false;}else $('winNotice').hidden=true;
  }
  function renderHome() {
    $('todayLabel').textContent=new Intl.DateTimeFormat(undefined,{weekday:'short',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date()).toUpperCase();
    chooseProblem();renderDashboard();
  }
  function updateTopic(topic) { selectedTopic=topic; chooseProblem(); }

  async function createSharedEntry(day, problem, start, deadline, resume = false) {
    sharedAttemptId=null; sharedBoardError=null;
    const {data:prior,error:lookupError}=await sb.from('competition_attempts').select('id,state').eq('user_id',currentUser.authUid).eq('competition_day',day).eq('topic',selectedTopic).maybeSingle();
    if(lookupError)throw new Error('Shared competition setup is unavailable. Run supabase/competitions.sql, then reload.');
    if(prior){sharedAttemptId=prior.id;if(prior.state==='done')throw new Error('You already submitted this topic today. Your shared result is on the leaderboard.');if(resume)return;throw new Error('Your entry for this topic is already active on another browser. Continue there or wait for the timer to finish.');}
    const {data,error}=await sb.from('competition_attempts').insert({user_id:currentUser.authUid,username:currentUser.username,competition_day:day,topic:selectedTopic,problem_id:problem.id,state:'live',started_at:new Date(start).toISOString(),deadline_at:new Date(deadline).toISOString()}).select('id').single();
    if(error)throw new Error('Could not create your shared entry: '+error.message);
    sharedAttemptId=data.id;
  }

  function saveAttempt(code) {
    if(!attemptId||finished)return Promise.resolve();
    safeText($('saveStatus'),'Saving…');
    sqlRun('UPDATE attempts SET code=? WHERE id=? AND state=\'live\'', [code,attemptId]);
    return persist().then(()=>safeText($('saveStatus'),'Saved in this browser')).catch(()=>safeText($('saveStatus'),'Save error'));
  }
  function getCode() { return editor ? editor.getValue() : $('code').value; }
  function setCode(value) { if(editor) editor.setValue(value); else $('code').value=value; }
  function onCodeChange() { safeText($('saveStatus'),'Saving…');clearTimeout(saveHandle);saveHandle=setTimeout(()=>saveAttempt(getCode()),350); }
  function showLockdown() {
    $('appView').hidden=true;$('siteHeader').hidden=true;$('arenaView').hidden=false;document.body.classList.add('locked');
    $('arenaProblem').textContent=selectedProblem.title;$('arenaTitle').textContent=selectedProblem.title;
    $('arenaTopic').textContent=`${DATA.topics.find(t=>t.id===selectedTopic).name} · LeetCode #${selectedProblem.number}`;
    $('arenaBlurb').textContent=selectedProblem.blurb;$('arenaDifficulty').textContent=selectedProblem.difficulty;$('arenaDifficulty').className='difficulty '+selectedProblem.difficulty.toLowerCase();
    $('arenaTime').textContent=selectedProblem.bestTime;$('arenaSpace').textContent=selectedProblem.bestSpace;showExamples(selectedProblem,$('arenaExamples'));
    if(window.CodeMirror&&!editor){editor=CodeMirror.fromTextArea($('code'),{mode:'python',theme:'material-darker',lineNumbers:true,indentUnit:4,tabSize:4,lineWrapping:true,autofocus:true});editor.on('change',onCodeChange);}
    else if(!editor)$('code').addEventListener('input',onCodeChange);
    setCode(row('SELECT code FROM attempts WHERE id=?',[attemptId])?.code||codeStarter(selectedProblem));
    setTimeout(()=>{if(editor){editor.refresh();editor.focus();}},50);
    window.history.pushState({locked:true},'',location.href);
    if(document.documentElement.requestFullscreen)document.documentElement.requestFullscreen().catch(()=>{});
  }
  async function resumeRace() {
    const live=row('SELECT * FROM attempts WHERE user_id=? AND state=? ORDER BY started_at DESC LIMIT 1',[currentUser.id,'live']);
    if(!live)return;
    selectedTopic=live.topic;selectedProblem=DATA.problems.find(p=>p.id===live.problem_id);attemptId=live.id;attemptDeadline=live.deadline_at;
    try{await createSharedEntry(live.day,selectedProblem,live.started_at,live.deadline_at,true);}catch(error){safeText($('boardStatus'),error.message);return;}
    finished=false;submitting=false;showLockdown();clearInterval(timerHandle);timerHandle=setInterval(tick,250);tick();
  }
  function tick() {
    const remaining=attemptDeadline-Date.now();
    $('clock').textContent=fmt(remaining);$('clock').className='clock'+(remaining<60000?' crit':remaining<120000?' warn':'');
    if(remaining<=0&&!finished)finishRace(true);
  }
  function fmt(ms){const s=Math.max(0,Math.ceil(ms/1000));return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;}
  async function enterArena() {
    const day=dayString(),old=attemptFor(day,selectedTopic);selectedProblem=todayProblem(selectedTopic);
    if(old){if(old.state==='done'){showResultFor(old);return;}attemptId=old.id;attemptDeadline=old.deadline_at;try{await createSharedEntry(day,selectedProblem,old.started_at,old.deadline_at,true);}catch(error){safeText($('boardStatus'),error.message);return;}}
    else {
      const start=Date.now(),deadline=start+minutes(selectedProblem)*60000;
      try{await createSharedEntry(day,selectedProblem,start,deadline);}catch(error){safeText($('boardStatus'),error.message);await renderBoard();return;}
      sqlRun('INSERT INTO attempts(user_id,day,topic,problem_id,state,code,started_at,deadline_at) VALUES(?,?,?,?,?,?,?,?)',[currentUser.id,day,selectedTopic,selectedProblem.id,'live',codeStarter(selectedProblem),start,deadline]);
      attemptId=rows('SELECT last_insert_rowid() AS id')[0].id;attemptDeadline=deadline;await persist();
    }
    finished=false;submitting=false;pendingFinish=false;showLockdown();safeText($('judgeOutput'),'Run generated tests to check your Python solution.');clearInterval(timerHandle);timerHandle=setInterval(tick,250);tick();
  }
  function ensureJudgeWorker() {
    if(judgeWorker)return judgeWorker;
    judgeWorker=new Worker('judge-worker.mjs',{type:'module'});
    judgeWorker.onmessage=event=>{const {id,result,error}=event.data,job=pendingJobs.get(id);if(!job)return;clearTimeout(job.timeout);pendingJobs.delete(id);if(error)job.reject(new Error(error));else job.resolve(result);};
    judgeWorker.onerror=event=>{for(const job of pendingJobs.values()){clearTimeout(job.timeout);job.reject(new Error(event.message||'Python worker failed.'));}pendingJobs.clear();judgeWorker.terminate();judgeWorker=null;};
    return judgeWorker;
  }
  function judgeCode(code, problem, timeoutMs=90000) {
    return new Promise((resolve,reject)=>{
      let worker;try{worker=ensureJudgeWorker();}catch(e){reject(e);return;}
      const id=++judgeJob,timeout=setTimeout(()=>{pendingJobs.delete(id);if(judgeWorker){judgeWorker.terminate();judgeWorker=null;}reject(new Error('The Python run exceeded its time limit and was stopped.'));},timeoutMs);
      pendingJobs.set(id,{resolve,reject,timeout});
      worker.postMessage({id,payload:{code,method:problem.method,kinds:problem.kinds,ret:problem.ret,checker:problem.checker,cases:problem.cases}});
    });
  }
  function showJudgeResult(r,target) {
    const out=$(target);out.className='judge-output '+(r.accepted?'good':'bad');
    if(r.accepted)out.textContent=`All ${r.total} tests passed (${r.total-r.simpleCount} generated cases).`;
    else {const f=r.first_fail;out.textContent=`${r.passed}/${r.total} tests passed.\n`+(r.error|| (f?`First failing test #${f.case}: ${f.error||'output did not match'}`:'Some generated cases did not pass.'))+(f&&f.input?'\nInput: '+JSON.stringify(f.input).slice(0,350):'');}
  }
  async function runCode() {
    if(judgeBusy||finished)return;judgeBusy=true;$('runCode').disabled=true;$('submitCode').disabled=true;
    safeText($('runStatus'),'Loading Python runtime and running simple + generated tests…');
    try{await saveAttempt(getCode());const result=await judgeCode(getCode(),selectedProblem);result.simpleCount=selectedProblem.simpleCount;showJudgeResult(result,'judgeOutput');safeText($('runStatus'),result.accepted?'All tests passed.':'Check the first failing test.');}
    catch(error){$('judgeOutput').className='judge-output bad';$('judgeOutput').textContent=error.message;safeText($('runStatus'),'Run stopped.');}
    finally{judgeBusy=false;$('runCode').disabled=false;$('submitCode').disabled=false;if(pendingFinish){pendingFinish=false;finishRace(true);}}
  }
  async function finishRace(byClock=false) {
    if(finished||submitting)return;if(judgeBusy){pendingFinish=true;safeText($('runStatus'),'Submitting as soon as the current test run stops…');return;}
    submitting=true;clearTimeout(saveHandle);clearInterval(timerHandle);$('exitLockdown').disabled=true;$('submitCode').disabled=true;$('runCode').disabled=true;
    safeText($('judgeOutput'),byClock?'Time is up. Submitting the latest saved Python code…':'Submitting your Python code to the generated test judge…');
    await saveAttempt(getCode());
    finished=true;submitting=false;
    try {
      const result=await judgeCode(getCode(),selectedProblem,120000),submitted=Date.now();
      sqlRun('UPDATE attempts SET state=?,submitted_at=?,accepted=?,passed=?,total=?,runtime_ms=?,memory_mb=?,verdict=?,error=? WHERE id=?',[
        'done',submitted,result.accepted?1:0,result.passed,result.total,result.runtime_ms,result.memory_mb,
        result.accepted?'Accepted':'Not accepted',result.error||(result.first_fail?`Case ${result.first_fail.case} did not pass.`:null),attemptId]);
      await persist();
      if(sharedAttemptId){const {error}=await sb.from('competition_attempts').update({state:'done',submitted_at:new Date(submitted).toISOString(),accepted:!!result.accepted,passed:result.passed,total:result.total,runtime_ms:result.runtime_ms,memory_mb:result.memory_mb,verdict:result.accepted?'Accepted':'Not accepted'}).eq('id',sharedAttemptId);if(error)sharedBoardError='Your result was saved on this device, but could not be uploaded to the shared leaderboard: '+error.message;}
      await showFinalResult(result,submitted);
    } catch(error) {
      sqlRun('UPDATE attempts SET state=?,submitted_at=?,accepted=0,verdict=?,error=? WHERE id=?',['done',Date.now(),'Judge error',error.message,attemptId]);await persist();
      if(sharedAttemptId){const {error:uploadError}=await sb.from('competition_attempts').update({state:'done',submitted_at:new Date().toISOString(),accepted:false,passed:0,total:selectedProblem.cases.length,verdict:'Judge error'}).eq('id',sharedAttemptId);if(uploadError)sharedBoardError='The judge error could not be uploaded to the shared leaderboard.';}
      await showFinalResult({accepted:false,error:error.message,passed:0,total:selectedProblem.cases.length,runtime_ms:null,memory_mb:null},Date.now());
    }
  }
  async function showFinalResult(result,submitted) {
    clearInterval(timerHandle);document.body.classList.remove('locked');if(document.fullscreenElement&&document.exitFullscreen)document.exitFullscreen().catch(()=>{});
    $('arenaView').hidden=true;$('resultDialog').hidden=false;
    const day=dayString(new Date(attemptDeadline-minutes(selectedProblem)*60000)),list=await renderBoard(day,selectedTopic),mine=list.find(r=>r.attempt_id===sharedAttemptId);
    $('resultTitle').textContent=result.accepted?(mine&&mine.rank===1&&day<dayString()?'Daily arena winner!':'Accepted'): 'Submission not accepted';
    $('resultText').textContent=(result.accepted?'Your Python code passed the example and generated cases. Runtime and memory are compared with accepted entrants in today’s shared topic competition.':(result.error||'Some simple or generated edge cases did not pass. You can review your code on the dashboard.'))+(sharedBoardError?' '+sharedBoardError:'');
    const stat=(label,value)=>`<div><small>${label}</small><b>${value}</b></div>`;
    let stats='';if(mine&&mine.rank)stats+=stat('LIVE RANK','#'+mine.rank);if(mine&&mine.score!=null)stats+=stat('SCORE',Number(mine.score).toFixed(1));
    stats+=stat('RUNTIME',Number.isFinite(result.runtime_ms)?result.runtime_ms.toFixed(2)+' ms':'—');
    stats+=stat('MEMORY',Number.isFinite(result.memory_mb)?result.memory_mb.toFixed(3)+' MB':'—');
    if(mine&&mine.rank){stats+=stat('TIME VS FIELD',Number(mine.time_pct).toFixed(1)+'%');stats+=stat('SPACE VS FIELD',Number(mine.space_pct).toFixed(1)+'%');}
    $('resultStats').innerHTML=stats;safeText($('exitLockdown'),'Submit & exit');$('exitLockdown').disabled=false;renderHome();
  }
  async function showResultFor(attempt) {
    selectedTopic=attempt.topic;selectedProblem=DATA.problems.find(p=>p.id===attempt.problem_id);attemptId=attempt.id;attemptDeadline=attempt.deadline_at;
    const {data}=await sb.from('competition_attempts').select('id').eq('user_id',currentUser.authUid).eq('competition_day',attempt.day).eq('topic',attempt.topic).maybeSingle();sharedAttemptId=data?.id||null;
    const result={accepted:attempt.accepted===1,error:attempt.error,passed:attempt.passed,total:attempt.total,runtime_ms:attempt.runtime_ms,memory_mb:attempt.memory_mb};await showFinalResult(result,attempt.submitted_at);
  }
  function bind() {
    applyTheme();
    $('showLogin').onclick=()=>setAuthMode('login');$('showSignup').onclick=()=>setAuthMode('signup');$('authForm').addEventListener('submit',authSubmit);$('signOut').onclick=signOut;
    $('forgotPassword').onclick=sendPasswordRecovery;$('recoveryForm').addEventListener('submit',submitPasswordRecovery);
    $('themeSelect').addEventListener('change',e=>{applyTheme(e.target.value);localStorage.setItem('leetcomp-theme',e.target.value);});
    $('saveProfile').onclick=saveProfile;
    $('topics').addEventListener('click',e=>{const b=e.target.closest('[data-topic]');if(b)updateTopic(b.dataset.topic);});
    $('boardDayToggle').onclick=()=>{boardOffset=boardOffset?0:1;renderBoard();};
    $('enterArena').onclick=enterArena;$('runCode').onclick=runCode;$('submitCode').onclick=()=>finishRace(false);$('exitLockdown').onclick=()=>finishRace(false);
    $('returnHome').onclick=()=>{ $('resultDialog').hidden=true;$('siteHeader').hidden=false;$('appView').hidden=false;renderHome(); };
    $('clearData').onclick=async()=>{if(!confirm('Delete all LeetComp accounts, races, and scores stored in this browser?'))return;localStorage.removeItem(SESSION_KEY);database.close();(await idb()).close();const req=indexedDB.deleteDatabase(DB_NAME);req.onsuccess=()=>location.reload();req.onerror=()=>alert('The browser could not clear the local database.');};
    window.addEventListener('beforeunload',e=>{if(attemptId&&!finished&&attemptDeadline>Date.now()){saveAttempt(getCode());e.preventDefault();e.returnValue='Your race is still active.';}});
    window.addEventListener('popstate',()=>{if(attemptId&&!finished&&attemptDeadline>Date.now())window.history.pushState({locked:true},'',location.href);});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&attemptId&&!finished){const a=row('SELECT deadline_at,code FROM attempts WHERE id=?',[attemptId]);if(a){attemptDeadline=a.deadline_at;setCode(a.code||'');if(attemptDeadline<=Date.now())finishRace(true);}}});
  }
  async function boot() {
    bind();
    try{await initDatabase();await restoreSession();setInterval(()=>{if(currentUser?.authUid&&!$('appView').hidden){if(observedUtcDay!==dayString()){observedUtcDay=dayString();boardOffset=0;renderHome();}else renderBoard();}},10000);}
    catch(error){$('authView').hidden=false;$('authMessage').textContent=error.message||'Could not load the local database.';}
  }
  boot();
})();
