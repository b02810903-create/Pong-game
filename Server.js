const express=require('express'),http=require('http'),WebSocket=require('ws'),path=require('path'),fs=require('fs');
const app=express(),server=http.createServer(app),wss=new WebSocket.Server({server});
app.use(express.static(path.join(__dirname,'public')));
app.use(express.json());
const DB=path.join(__dirname,'db.json');
function loadDB(){try{if(fs.existsSync(DB))return JSON.parse(fs.readFileSync(DB,'utf8'))}catch(e){}return{leaderboard:[],adminPass:'pong2024'}}
function saveDB(){try{fs.writeFileSync(DB,JSON.stringify(db,null,2))}catch(e){}}
let db=loadDB();
setInterval(saveDB,30000);
app.get('/api/leaderboard',(q,r)=>{r.json(db.leaderboard.sort((a,b)=>b.totalPts-a.totalPts).slice(0,100))});
app.post('/api/score',(q,r)=>{const{name,points}=q.body;if(!name||typeof points!=='number'||points<=0)return r.status(400).json({error:'bad'});let p=db.leaderboard.find(x=>x.name.toLowerCase()===name.toLowerCase());if(p){p.totalPts+=points;p.games++;p.lastPlayed=Date.now();if(points>p.bestGame)p.bestGame=points}else{p={name,totalPts:points,games:1,bestGame:points,joined:Date.now(),lastPlayed:Date.now()};db.leaderboard.push(p)}db.leaderboard.sort((a,b)=>b.totalPts-a.totalPts);if(db.leaderboard.length>500)db.leaderboard=db.leaderboard.slice(0,500);saveDB();const rank=db.leaderboard.findIndex(x=>x.name.toLowerCase()===name.toLowerCase())+1;r.json({ok:true,rank,player:p})});
app.get('/api/player/:name',(q,r)=>{const p=db.leaderboard.find(x=>x.name.toLowerCase()===q.params.name.toLowerCase());if(!p)return r.json({found:false});const rank=db.leaderboard.sort((a,b)=>b.totalPts-a.totalPts).findIndex(x=>x.name===p.name)+1;r.json({found:true,player:p,rank})});
app.get('/api/stats',(q,r)=>{r.json({totalPlayers:db.leaderboard.length,totalGames:db.leaderboard.reduce((s,p)=>s+p.games,0),totalPoints:db.leaderboard.reduce((s,p)=>s+p.totalPts,0)})});
app.post('/api/admin/clear',(q,r)=>{if(q.body.pass!==db.adminPass)return r.status(403).json({error:'wrong'});db.leaderboard=[];saveDB();r.json({ok:true})});
app.post('/api/admin/delete-player',(q,r)=>{if(q.body.pass!==db.adminPass)return r.status(403).json({error:'wrong'});db.leaderboard=db.leaderboard.filter(p=>p.name.toLowerCase()!==(q.body.name||'').toLowerCase());saveDB();r.json({ok:true})});
app.post('/api/admin/add-points',(q,r)=>{if(q.body.pass!==db.adminPass)return r.status(403).json({error:'wrong'});let p=db.leaderboard.find(x=>x.name.toLowerCase()===(q.body.name||'').toLowerCase());if(p){p.totalPts+=(q.body.points||0)}else{db.leaderboard.push({name:q.body.name,totalPts:q.body.points||0,games:0,bestGame:q.body.points||0,joined:Date.now(),lastPlayed:Date.now()})}db.leaderboard.sort((a,b)=>b.totalPts-a.totalPts);saveDB();r.json({ok:true})});
app.post('/api/admin/change-pass',(q,r)=>{if(q.body.oldPass!==db.adminPass)return r.status(403).json({error:'wrong'});db.adminPass=q.body.newPass;saveDB();r.json({ok:true})});
const lobbies={};
function genCode(){const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let code='';for(let i=0;i<5;i++)code+=c[Math.floor(Math.random()*c.length)];return code}
wss.on('connection',(ws)=>{
ws.isAlive=true;ws.waiting=false;
ws.on('pong',()=>ws.isAlive=true);
ws.on('message',(raw)=>{
let msg;try{msg=JSON.parse(raw)}catch(e){return}
switch(msg.type){
case'create':{cleanup(ws);ws.waiting=false;const code=genCode();lobbies[code]={host:ws,guest:null,hostName:msg.name||'?'};ws.lobby=code;ws.role='host';ws.send(JSON.stringify({type:'created',code}));break}
case'join':{const code=(msg.code||'').toUpperCase().trim();const L=lobbies[code];if(!L)return ws.send(JSON.stringify({type:'error',text:'Не найдено'}));if(L.guest)return ws.send(JSON.stringify({type:'error',text:'Полное'}));if(L.host===ws)return ws.send(JSON.stringify({type:'error',text:'Нельзя'}));L.guest=ws;L.guestName=msg.name||'?';ws.lobby=code;ws.role='guest';ws.waiting=false;L.host.send(JSON.stringify({type:'start',role:'host',enemy:L.guestName}));L.guest.send(JSON.stringify({type:'start',role:'guest',enemy:L.hostName}));break}
case'move':{const L=lobbies[ws.lobby];if(!L)return;const o=ws.role==='host'?L.guest:L.host;if(o&&o.readyState===1)o.send(JSON.stringify({type:'move',x:msg.x}));break}
case'ball':{const L=lobbies[ws.lobby];if(!L||ws.role!=='host')return;if(L.guest&&L.guest.readyState===1)L.guest.send(JSON.stringify({type:'ball',x:msg.x,y:msg.y,vx:msg.vx,vy:msg.vy}));break}
case'scored':{const L=lobbies[ws.lobby];if(!L||ws.role!=='host')return;if(L.guest&&L.guest.readyState===1)L.guest.send(JSON.stringify({type:'scored',s1:msg.s1,s2:msg.s2}));break}
case'gameover':{const L=lobbies[ws.lobby];if(!L)return;const d=JSON.stringify({type:'gameover',winner:msg.winner,s1:msg.s1,s2:msg.s2});[L.host,L.guest].forEach(w=>{if(w&&w.readyState===1)w.send(d)});break}
case'matchmake':{cleanup(ws);ws.mmName=msg.name||'?';let found=false;for(const client of wss.clients){if(client!==ws&&client.waiting&&client.readyState===1){client.waiting=false;ws.waiting=false;const code=genCode();lobbies[code]={host:client,guest:ws,hostName:client.mmName,guestName:ws.mmName};client.lobby=code;client.role='host';ws.lobby=code;ws.role='guest';client.send(JSON.stringify({type:'start',role:'host',enemy:ws.mmName}));ws.send(JSON.stringify({type:'start',role:'guest',enemy:client.mmName}));found=true;break}}if(!found){ws.waiting=true;let count=0;wss.clients.forEach(c=>{if(c.waiting)count++});ws.send(JSON.stringify({type:'queue_size',count}))}break}
case'queue_check':{let count=0;wss.clients.forEach(c=>{if(c.waiting)count++});ws.send(JSON.stringify({type:'queue_size',count}));break}
case'leave_queue':{ws.waiting=false;break}
case'leave':{cleanup(ws);break}
}});
ws.on('close',()=>{ws.waiting=false;cleanup(ws)});
});
function cleanup(ws){const code=ws.lobby;if(!code||!lobbies[code])return;const L=lobbies[code];const o=ws.role==='host'?L.guest:L.host;if(o&&o.readyState===1)o.send(JSON.stringify({type:'left'}));delete lobbies[code];ws.lobby=null}
setInterval(()=>{wss.clients.forEach(ws=>{if(!ws.isAlive)return ws.terminate();ws.isAlive=false;ws.ping()})},30000);
const PORT=process.env.PORT||3000;
server.listen(PORT,'0.0.0.0',()=>console.log('Pong on port '+PORT));
