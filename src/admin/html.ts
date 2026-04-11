export function getAdminHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Limitless / Admin</title>
  <style>
    :root {
      --bg:#0d1117;--surface:#161b22;--card:#1c2128;
      --text:#e6edf3;--muted:#8b949e;--accent:#f0a500;
      --border:#30363d;--danger:#da3633;
      --sans:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
      --mono:ui-monospace,'Cascadia Code','Fira Code',monospace;
    }
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:var(--bg);color:var(--text);font-family:var(--sans);min-height:100vh}
    nav{background:var(--surface);border-bottom:1px solid var(--border);
        padding:12px 24px;display:flex;align-items:center;gap:16px;
        position:sticky;top:0;z-index:10}
    .logo{font-size:14px;color:var(--muted)}
    .logo em{color:var(--accent);font-style:normal}
    #status{margin-left:auto;font-size:13px;color:var(--muted)}
    .filters{padding:16px 24px;display:flex;gap:12px;flex-wrap:wrap;
             border-bottom:1px solid var(--border);background:var(--surface)}
    select,button{background:var(--card);color:var(--text);border:1px solid var(--border);
                  border-radius:6px;padding:6px 12px;font-size:13px;cursor:pointer}
    button.active{border-color:var(--accent);color:var(--accent)}
    #entries{padding:16px 24px;display:flex;flex-direction:column;gap:10px;max-width:900px}
    .card{background:var(--card);border:1px solid var(--border);border-radius:8px;
          padding:14px 16px;display:grid;grid-template-columns:1fr auto;gap:8px;align-items:start}
    .card-title{font-size:14px;font-weight:500;margin-bottom:4px}
    .card-meta{font-size:12px;color:var(--muted);font-family:var(--mono);display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}
    .badge{padding:2px 6px;border-radius:4px;font-size:11px;border:1px solid var(--border);color:var(--muted)}
    .badge-work{border-color:#388bfd44;color:#388bfd}
    .badge-personal{border-color:#3fb95044;color:#3fb950}
    .badge-shared,.badge-pinned{border-color:var(--accent);color:var(--accent)}
    .badge-superseded{border-color:#da363344;color:#da3633}
    .controls{display:flex;gap:6px;align-items:center}
    .controls select{padding:4px 8px;font-size:12px}
    .btn-pin{background:none;border:1px solid var(--border);padding:4px 8px;border-radius:4px;color:var(--muted)}
    .btn-pin.active{color:var(--accent);border-color:var(--accent)}
    .btn-del{background:none;border:1px solid transparent;padding:4px 8px;border-radius:4px;color:var(--danger)}
    .btn-del:hover{border-color:var(--danger)}
    .rels-panel{grid-column:1/-1;padding:8px 0;border-top:1px solid var(--border);margin-top:8px;font-size:12px;color:var(--muted)}
    .rel-row{padding:4px 0;font-family:var(--mono);font-size:12px}
    .btn-rel{background:none;border:1px solid var(--border);padding:4px 8px;border-radius:4px;color:var(--muted)}
    #load-more-wrap{padding:16px 24px}
    #login{display:flex;flex-direction:column;align-items:center;justify-content:center;
           min-height:80vh;gap:16px}
    #login h1{font-size:24px}
    #login p{color:var(--muted)}
    #login a{background:var(--accent);color:#000;padding:10px 24px;border-radius:6px;
             text-decoration:none;font-weight:500}
  </style>
</head>
<body>
  <nav>
    <span class="logo">limitless / <em>admin</em></span>
    <span id="status">loading...</span>
  </nav>
  <div id="login" style="display:none">
    <h1>Limitless Admin</h1>
    <p>Sign in with your Google account to manage entries.</p>
    <a href="/admin/login">Sign in with Google</a>
  </div>
  <div id="app" style="display:none">
    <div class="filters">
      <select id="f-ns">
        <option value="">All namespaces</option>
        <option value="work">Work</option>
        <option value="personal">Personal</option>
        <option value="shared">Shared</option>
        <option value="null">Unnamespaced</option>
      </select>
      <select id="f-type">
        <option value="">All types</option>
        <option value="identity">identity</option>
        <option value="rules">rules</option>
        <option value="catalog">catalog</option>
        <option value="framework">framework</option>
        <option value="decision">decision</option>
        <option value="project">project</option>
        <option value="handoff">handoff</option>
        <option value="resource">resource</option>
        <option value="memory">memory</option>
      </select>
      <button id="f-pinned">Pinned only</button>
      <button id="bulk-del" style="display:none;color:var(--danger);border-color:var(--danger)">Delete selected</button>
    </div>
    <div id="entries"></div>
    <div id="load-more-wrap" style="display:none">
      <button id="load-more">Load more</button>
    </div>
  </div>
  <script>
  (function(){
    const LIMIT=50;
    let token=null,offset=0,filters={},pinnedOnly=false;

    function getToken(){
      if(location.hash.startsWith('#token=')){
        const t=decodeURIComponent(location.hash.slice(7));
        sessionStorage.setItem('lx_admin_token',t);
        history.replaceState(null,'','/admin');
        return t;
      }
      return sessionStorage.getItem('lx_admin_token');
    }

    async function api(path,opts={}){
      const res=await fetch(path,{
        ...opts,
        headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(opts.headers||{})}
      });
      if(res.status===401){sessionStorage.removeItem('lx_admin_token');location.reload();}
      return res;
    }

    function el(tag,cls=''){const e=document.createElement(tag);if(cls)e.className=cls;return e;}

    function badge(text,cls=''){
      const b=el('span','badge'+(cls?' '+cls:''));
      b.textContent=text; // textContent — never innerHTML for user data
      return b;
    }

    function buildCard(entry){
      const ns=entry.namespace;
      const pinned=entry.pinned===1;
      const card=el('div','card');
      card.dataset.id=entry.id;

      // Left column: title + meta
      const left=el('div');

      const titleEl=el('div','card-title');
      titleEl.textContent=entry.title||entry.content?.slice(0,80)||entry.id; // safe: textContent
      left.appendChild(titleEl);

      const meta=el('div','card-meta');
      meta.appendChild(badge(ns||'none', ns?'badge-'+ns:''));
      meta.appendChild(badge(entry.type));
      if(pinned) meta.appendChild(badge('pinned','badge-pinned'));
      if(entry.supersedes) meta.appendChild(badge('supersedes','badge-superseded'));
      if(entry.tags){const t=el('span');t.textContent=entry.tags;meta.appendChild(t);}
      const d=el('span');
      d.textContent='updated '+new Date(entry.updated_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
      meta.appendChild(d);
      left.appendChild(meta);
      card.appendChild(left);

      // Right column: controls
      const controls=el('div','controls');

      const cb=el('input');cb.type='checkbox';cb.className='entry-cb';cb.dataset.id=entry.id;
      controls.insertBefore(cb,controls.firstChild);

      // Namespace dropdown — all options are static strings (no user data in option values)
      const nsSel=el('select'); nsSel.dataset.id=entry.id;
      [['','— ns —'],['work','work'],['personal','personal'],['shared','shared'],['clear','clear']].forEach(([v,l])=>{
        const o=document.createElement('option');
        o.value=v; o.textContent=l; // textContent for label
        if((ns||'')===(v===''?'':v)) o.selected=true;
        nsSel.appendChild(o);
      });
      controls.appendChild(nsSel);

      const pinBtn=el('button','btn-pin'+(pinned?' active':''));
      pinBtn.dataset.id=entry.id; pinBtn.title='Toggle pinned';
      pinBtn.textContent=pinned?'📌':'📍'; // emoji only, not user data
      controls.appendChild(pinBtn);

      const relBtn=el('button','btn-rel');
      relBtn.dataset.id=entry.id; relBtn.title='View relationships';
      relBtn.textContent='🔗';
      controls.appendChild(relBtn);

      const delBtn=el('button','btn-del');
      delBtn.dataset.id=entry.id; delBtn.title='Delete';
      delBtn.textContent='✕'; // static
      controls.appendChild(delBtn);

      card.appendChild(controls);
      return card;
    }

    async function load(reset=false){
      if(reset){offset=0;document.getElementById('entries').innerHTML='';}
      const p=new URLSearchParams({limit:LIMIT,offset,...filters});
      if(pinnedOnly) p.set('pinned','true');
      const res=await api('/api/entries?'+p);
      const {results=[]}=await res.json();
      results.forEach(e=>document.getElementById('entries').appendChild(buildCard(e)));
      offset+=results.length;
      document.getElementById('load-more-wrap').style.display=results.length===LIMIT?'block':'none';
      document.getElementById('status').textContent=offset+' entries';
    }

    // Event delegation — changes and clicks on the entry list
    document.getElementById('entries').addEventListener('change',async e=>{
      if(e.target.classList.contains('entry-cb')){
        const anyChecked=document.querySelectorAll('.entry-cb:checked').length>0;
        document.getElementById('bulk-del').style.display=anyChecked?'inline-block':'none';
        return;
      }
      const sel=e.target.closest('select[data-id]');
      if(!sel) return;
      const ns=sel.value==='clear'?null:sel.value||null;
      await api('/api/entries/'+sel.dataset.id,{method:'PATCH',body:JSON.stringify({namespace:ns})});
      load(true);
    });

    document.getElementById('entries').addEventListener('click',async e=>{
      const pin=e.target.closest('.btn-pin');
      if(pin){
        const active=pin.classList.contains('active');
        await api('/api/entries/'+pin.dataset.id,{method:'PATCH',body:JSON.stringify({pinned:!active})});
        return load(true);
      }
      const del=e.target.closest('.btn-del');
      if(del){
        if(!confirm('Delete this entry? This cannot be undone.')) return;
        await api('/api/entries/'+del.dataset.id,{method:'DELETE'});
        del.closest('.card').remove();
        offset--;
        document.getElementById('status').textContent=offset+' entries';
        return;
      }
      const relBtn=e.target.closest('.btn-rel');
      if(relBtn){
        const card=relBtn.closest('.card');
        let panel=card.querySelector('.rels-panel');
        if(panel){panel.remove();return;}
        panel=el('div','rels-panel');
        panel.textContent='Loading...';
        card.appendChild(panel);
        const res=await api('/api/entries/'+relBtn.dataset.id+'/relationships');
        const {results=[]}=await res.json();
        panel.textContent='';
        if(results.length===0){panel.textContent='No relationships';return;}
        results.forEach(r=>{
          const row=el('div','rel-row');
          const dir=r.source_id===relBtn.dataset.id?'→':'←';
          const otherId=r.source_id===relBtn.dataset.id?r.target_id:r.source_id;
          const validity=r.valid_to?'expired '+new Date(r.valid_to).toLocaleDateString():'current';
          row.textContent=r.rel_type+' '+dir+' '+otherId.slice(0,8)+'... ('+validity+')';
          if(r.label){const lb=el('span');lb.textContent=' — '+r.label;lb.style.color='var(--muted)';row.appendChild(lb);}
          panel.appendChild(row);
        });
      }
    });

    document.getElementById('bulk-del').addEventListener('click',async()=>{
      const checked=document.querySelectorAll('.entry-cb:checked');
      if(!confirm('Delete '+checked.length+' entries? This cannot be undone.')) return;
      for(const cb of checked){
        await api('/api/entries/'+cb.dataset.id,{method:'DELETE'});
      }
      load(true);
      document.getElementById('bulk-del').style.display='none';
    });

    document.getElementById('f-ns').addEventListener('change',e=>{
      if(e.target.value) filters.namespace=e.target.value; else delete filters.namespace;
      load(true);
    });
    document.getElementById('f-type').addEventListener('change',e=>{
      if(e.target.value) filters.type=e.target.value; else delete filters.type;
      load(true);
    });
    document.getElementById('f-pinned').addEventListener('click',e=>{
      pinnedOnly=!pinnedOnly; e.target.classList.toggle('active',pinnedOnly); load(true);
    });
    document.getElementById('load-more').addEventListener('click',()=>load());

    // Init
    token=getToken();
    if(!token){document.getElementById('login').style.display='flex';}
    else{document.getElementById('app').style.display='block';load(true);}
  })();
  </script>
</body>
</html>`;
}
