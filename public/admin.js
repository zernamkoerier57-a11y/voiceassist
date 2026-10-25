var $=function(i){return document.getElementById(i)},PW=sessionStorage.getItem('pw')||'',cur='',last=0,loaded=false,S=null,timer=null,arch=0,presets=[],editIdx=-1,
MAP={am:'avatar_mode',ag:'avatar_gender',vo:'voice',gr:'greeting',mo:'model',tp:'temp',an:'agent_name',co:'company',ro:'role',to:'tone',ln:'length',kn:'knowledge',ru:'rules',pr:'prompt',me:'memory'},
RP={biller:'a friendly billing and support assistant who helps with invoice questions and subscription requests',general:'a helpful general-purpose assistant',sales:'a friendly sales assistant who explains plans and helps people choose',health:'a calm front-desk assistant who helps with appointments and general questions'};

function showTab(name){
  document.querySelectorAll('.page').forEach(function(p){p.classList.toggle('on',p.id==='pg-'+name)});
  document.querySelectorAll('.tab-btn').forEach(function(b){b.classList.toggle('on',b.dataset.tab===name)});
}
document.querySelectorAll('.tab-btn').forEach(function(b){
  b.onclick=function(){showTab(b.dataset.tab)};
});

function openSc(id){var el=$('sc-'+id);if(el)el.classList.add('open')}
function closeSc(id){var el=$('sc-'+id);if(el)el.classList.remove('open')}
function closeAllSc(){['kn','ru','pr','me'].forEach(closeSc)}
function updateScPreviews(){
  ['kn','ru','pr','me'].forEach(function(id){
    var el=$('prev-'+id),ta=$(id);
    if(!el||!ta)return;
    var t=trunc(ta.value,140);
    el.textContent=t||'(empty — click Edit to add)';
    el.style.fontStyle=t?'normal':'italic';
  });
}
function trunc(s,n){s=String(s||'').replace(/\s+/g,' ').trim();if(!s)return '';return s.length>n?s.slice(0,n)+'…':s}
function drawPresets(){
  if(!presets.length){
    $('plist').innerHTML='<div class="empty">No instructions yet.<br><span style="font-size:.85rem">Example label: <b>Tell them to call support</b></span></div>';
    return;
  }
  $('plist').innerHTML=presets.map(function(p,i){
    if(editIdx===i){
      return '<div class="pcard open" data-i="'+i+'">'+'<div class="row-line"><span class="num">#'+(i+1)+'</span><span style="flex:1"></span>'+'<div class="acts"><button type="button" data-a="done" data-i="'+i+'">Done</button>'+'<button type="button" class="bad" data-a="rmp" data-i="'+i+'">Remove</button></div></div>'+'<label>Short label (button text)<input data-pi="'+i+'" data-pf="label" value="'+esc(p.label||'')+'" placeholder="e.g. Call support team"></label>'+'<label>What the agent should do<textarea rows="4" data-pi="'+i+'" data-pf="detail" placeholder="Tell the caller to contact the support team…">'+esc(p.detail||'')+'</textarea></label>'+'</div>';
    }
    var lab=(p.label||'').trim();
    var prev=trunc(p.detail,120);
    return '<div class="pcard" data-i="'+i+'">'+'<div class="row-line">'+'<span class="num">#'+(i+1)+'</span>'+'<span class="title'+(lab?'':' empty-t')+'">'+(lab?esc(lab):'Untitled')+'</span>'+'<div class="acts">'+'<button type="button" data-a="edit" data-i="'+i+'">Edit</button>'+'<button type="button" class="bad" data-a="rmp" data-i="'+i+'">Remove</button>'+'</div>'+'</div>'+(prev?'<div class="preview">'+esc(prev)+'</div>':'')+'</div>';
  }).join('');
}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&','<':'<','>':'>','"':'"'}[c]})}
function call(p,b){
  var o={headers:{'x-admin':PW,'Content-Type':'application/json'}};
  if(b){o.method='POST';o.body=JSON.stringify(b)}
  return fetch('/api/admin/'+p,o).then(function(r){if(r.status===401){logout();throw 0}return r.json()})
}
function logout(){PW='';sessionStorage.removeItem('pw');clearInterval(timer);$('app').hidden=true;$('login').hidden=false}
function boot(){$('login').hidden=true;$('app').hidden=false;loaded=false;poll();clearInterval(timer);timer=setInterval(poll,2500)}
$('go').onclick=function(){PW=$('pw').value;call('state').then(function(){sessionStorage.setItem('pw',PW);boot()}).catch(function(){$('err').textContent='Wrong password'})};
$('pw').onkeydown=function(e){if(e.key==='Enter')$('go').click()};
$('out').onclick=logout;
if(PW)call('state').then(boot).catch(function(){});

function poll(){call('state?arch='+arch).then(function(d){S=d;render(d);if(cur)loadMsgs()}).catch(function(){})}
function render(d){
  var on=d.settings.enabled==='1',live=d.sessions.filter(function(s){return s.live}).length;
  $('cnt').textContent=live?('● '+live+' live'):'';
  $('master').textContent=on?'Agent ON':'Agent OFF';
  $('master').style.borderColor=on?'var(--g)':'var(--l)';
  $('lk').innerHTML=d.links.map(function(l){
    var ex=l.expires&&l.expires<Date.now();
    return '<tr><td>'+esc(l.name)+(l.live?' <span class=lv>● live</span>':'')+'</td><td>'+(!l.active?'Off':ex?'Expired':'On')+'</td><td>'+l.used+(l.max_sessions?' / '+l.max_sessions:'')+'</td><td>'+(l.expires?new Date(l.expires).toLocaleString():'Never')+'</td><td>'+(l.max_sec?l.max_sec/60+' min':'None')+'</td><td><button data-a=copy data-id="'+l.id+'">Copy</button> <button data-a=tog data-id="'+l.id+'" data-v="'+(l.active?0:1)+'">'+(l.active?'Off':'On')+'</button> <button class=bad data-a=del data-id="'+l.id+'">Delete</button></td></tr>'
  }).join('')||'<tr><td colspan=6 class=mut>No links yet</td></tr>';
  $('ss').innerHTML=d.sessions.map(function(s){
    var b='<button data-a=view data-id="'+s.id+'" data-n="'+esc(s.name)+'">'+(s.live?'Listen':'View')+'</button> ';
    b+=s.live?'<button class=bad data-a=kill data-id="'+s.id+'">End</button>':'<button data-a=arc data-id="'+s.id+'" data-v="'+(arch?0:1)+'">'+(arch?'Restore':'Archive')+'</button> <button class=bad data-a=sdel data-id="'+s.id+'">Delete</button>';
    return '<tr><td>'+esc(s.name)+'</td><td class=mut>'+new Date(s.started).toLocaleString()+'</td><td>'+(s.live?'<span class=lv>● live</span>':'<span class=mut>ended</span>')+'</td><td>'+b+'</td></tr>'
  }).join('')||'<tr><td colspan=4 class=mut>No conversations</td></tr>';
  var cs=d.sessions.filter(function(x){return x.id===cur})[0];
  $('ctl').style.display=cs&&cs.live?'flex':'none';
  if(cs&&cs.live){
    var bt=presets.map(function(p,i){return (p.label||'').trim()?'<button type="button" class="qbtn" data-a="pre" data-i="'+i+'">'+esc(p.label)+'</button>':''}).join('');
    if($('pbtns').getAttribute('data-h')!==bt){$('pbtns').innerHTML=bt||'<span class="mut" style="font-size:.8rem">No presets — add some in Quick Instructions</span>';$('pbtns').setAttribute('data-h',bt)}
    var asks=(d.asks||[]).filter(function(a){return a.sid===cur});
    var ah=asks.map(function(a){
        var q=a.question||'', isStep=q.indexOf('NEXT STEP:')===0;
        var body=isStep?esc(q.replace(/^NEXT STEP:\s*/,'')) : esc(q);
        var head=isStep?'<b>Next script step — confirm?</b>':'<b>Agent is waiting</b>';
        var acts=isStep
          ? '<div class="row" style="margin-top:8px"><button class="pri" data-a="yes" data-id="'+a.id+'" data-step="'+esc(q.replace(/^NEXT STEP:\s*/,''))+'">Yes, proceed</button><button data-a="no" data-id="'+a.id+'">No, wait</button></div><div class="row" style="margin-top:6px"><input id="aw'+a.id+'" placeholder="Or type a different instruction" style="flex:1"><button class="pri" data-a="ans" data-id="'+a.id+'">Send</button></div>'
          : '<div class="row" style="margin-top:6px"><input id="aw'+a.id+'" placeholder="Your answer" style="flex:1"><button class="pri" data-a="ans" data-id="'+a.id+'">Send answer</button></div>';
        return '<div class="m ask" style="margin-bottom:8px">'+head+'<div style="margin-top:6px">'+body+'</div>'+acts+'</div>';
      }).join('');
      if($('aq').getAttribute('data-h')!==ah){$('aq').innerHTML=ah;$('aq').setAttribute('data-h',ah)}
      $('aq-wrap').style.display=asks.length?'block':'none';
  } else {$('aq').innerHTML='';$('aq').setAttribute('data-h','');$('aq-wrap').style.display='none'}
  if(!loaded){
    loaded=true;
    for(var k in MAP)$(k).value=d.settings[MAP[k]]||'';
    try{presets=JSON.parse(d.settings.presets||'[]')}catch(e){presets=[]}
    if(!Array.isArray(presets))presets=[];
    editIdx=-1;
    drawPresets();
    closeAllSc();
    updateScPreviews();
  }
}

document.addEventListener('click',function(e){
  var b=e.target.closest('button[data-a]');if(!b)return;
  var a=b.dataset.a,id=b.dataset.id;
  if(a==='copy'){var u=location.origin+'/?k='+id;(navigator.clipboard?navigator.clipboard.writeText(u):Promise.reject()).then(function(){b.textContent='Copied'}).catch(function(){prompt('Copy this link',u)})}
  if(a==='tog')call('toggle',{id:id,active:b.dataset.v==='1'}).then(poll);
  if(a==='del'&&confirm('Delete this link? Live sessions will end.'))call('delete',{id:id}).then(poll);
  if(a==='kill')call('kill',{sid:id}).then(poll);
  if(a==='arc')call('archive',{sid:id,flag:b.dataset.v==='1'}).then(poll);
  if(a==='sdel'&&confirm('Delete this conversation permanently?'))call('sdelete',{sid:id}).then(function(){if(cur===id)$('dc').click();poll()});
  if(a==='view')openT(id,b.dataset.n);
  if(a==='edit'){editIdx=+b.dataset.i;drawPresets()}
  if(a==='done'){editIdx=-1;drawPresets()}
  if(a==='rmp'){var ix=+b.dataset.i;presets.splice(ix,1);if(editIdx===ix)editIdx=-1;else if(editIdx>ix)editIdx--;drawPresets()}
  if(a==='scedit')openSc(b.dataset.sc);
  if(a==='scdone'){closeSc(b.dataset.sc);updateScPreviews()}
  if(a==='pre'&&cur){var pr=presets[+b.dataset.i];if(pr)call('cmd',{sid:cur,type:'instruct',text:pr.detail||pr.label}).then(loadMsgs)}
  if(a==='ans'&&cur){var inp=$('aw'+id);call('answer',{sid:cur,id:id,text:inp?inp.value:''}).then(function(){poll();loadMsgs()})}
  if(a==='yes'&&cur){call('answer',{sid:cur,id:id,text:'Yes. Proceed with this step now: '+(b.dataset.step||'')}).then(function(){poll();loadMsgs()})}
  if(a==='no'&&cur){call('answer',{sid:cur,id:id,text:'No. Do not do that step. Do not continue the main script. Wait for a live instruction from the admin before saying anything more about the script.'}).then(function(){poll();loadMsgs()})}
});
$('master').onclick=function(){var on=S&&S.settings.enabled==='1';saveAll({enabled:on?'0':'1'}).then(poll)};
$('mk').onclick=function(){call('create',{name:$('n').value,hours:+$('h').value,min:+$('mm').value,max:+$('ms').value}).then(function(){$('n').value='';poll()})};
$('killall').onclick=function(){if(confirm('End all live sessions?'))call('killall',{}).then(poll)};
function saveAll(extra){
  var o={};
  for(var k in MAP)o[MAP[k]]=$(k)?$(k).value:'';
  o.presets=JSON.stringify(presets.map(function(p){return{label:String(p.label||'').slice(0,80),detail:String(p.detail||'').slice(0,2000)}}));
  if(extra)for(var x in extra)o[x]=extra[x];
  return call('settings',o);
}
$('sv').onclick=function(){closeAllSc();updateScPreviews();saveAll().then(function(){$('ok').textContent='Saved';setTimeout(function(){$('ok').textContent=''},2000)})};
$('svP').onclick=function(){editIdx=-1;drawPresets();saveAll().then(function(){$('okP').textContent='Saved';setTimeout(function(){$('okP').textContent=''},2000)})};
$('addP').onclick=function(){presets.push({label:'',detail:''});editIdx=presets.length-1;drawPresets()};
document.addEventListener('input',function(e){var el=e.target;if(!el.dataset||el.dataset.pf==null||el.dataset.pi==null)return;presets[+el.dataset.pi][el.dataset.pf]=el.value});
$('ag').onchange=function(){$('vo').value=this.value==='male'?'aura-2-orion-en':'aura-2-thalia-en'};
$('rp').onchange=function(){if(RP[this.value])$('ro').value=RP[this.value]};
$('tabA').onclick=function(){arch=0;poll()};$('tabR').onclick=function(){arch=1;poll()};
$('bulkA').onclick=function(){if(confirm('Archive all ended conversations?'))call('clear',{mode:'archive',arch:arch}).then(poll)};
$('bulkD').onclick=function(){if(confirm('Permanently delete all ended conversations in this list?'))call('clear',{mode:'delete',arch:arch}).then(poll)};
function sendC(t,remember){var v=$('ct').value.trim();if(!v||!cur)return;call('cmd',{sid:cur,type:t,text:v,remember:!!remember}).then(function(){$('ct').value='';loadMsgs();if(remember)poll()})}
$('csay').onclick=function(){sendC('say')};
$('cins').onclick=function(){sendC('instruct')};
if($('crem'))$('crem').onclick=function(){sendC('instruct',true)};
if($('clrMe'))$('clrMe').onclick=function(){if(!confirm('Clear all learned memory?'))return;$('me').value='';updateScPreviews();saveAll().then(function(){$('ok').textContent='Memory cleared';setTimeout(function(){$('ok').textContent=''},2000)})};
function openT(id,n){cur=id;last=0;$('tr').innerHTML='';$('dt').textContent=n||'Untitled';$('drawer').style.display='flex';$('overlay').style.display='block';loadMsgs()}
function loadMsgs(){var id=cur;call('msgs?sid='+id+'&after='+last).then(function(a){if(id!==cur)return;var labels={user:'Caller',assistant:'Agent',admin:'You',ask:'Agent ask',sys:'System'};a.forEach(function(m){last=m.id;var d=document.createElement('div');d.className='m '+(m.role||'assistant');var who=labels[m.role]||m.role;d.innerHTML='<div class="who">'+esc(who)+'</div>'+esc(m.content);$('tr').appendChild(d)});if(a.length)$('tr').scrollTop=1e9})}
$('dc').onclick=function(){cur='';$('drawer').style.display='none';$('overlay').style.display='none'};
$('overlay').onclick=function(){$('dc').click()};
$('de').onclick=function(){if(cur)call('kill',{sid:cur}).then(poll)};
