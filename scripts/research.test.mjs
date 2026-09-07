import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {captureResearch} from './research.mjs';
import {readImage} from './model.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2XcAAAAASUVORK5CYII=','base64');
const state={url:'https://example.com/editor',title:'Editor',ready:'complete',text:'编辑器',viewport:{width:390,height:844,deviceScaleFactor:2},scroll:{x:0,y:0}};
const options=out=>({url:state.url,out,id:'e01-editor',state:'编辑器默认','expect-text':'编辑器'});
test('capture 拒绝登录跳转与截图中途视口变化，不产生误标证据',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pm-research-'));
 try{
 let shots=0;const b={evaluate:async()=>({...state,url:'https://example.com/login'}),screenshot:async()=>{shots++;return png;}};
 await assert.rejects(captureResearch(b,'tab',options(dir)),/不是要记录的页面/);assert.equal(shots,0);
 let n=0;b.evaluate=async()=>n++===0?state:{...state,viewport:{...state.viewport,width:800}};
 await assert.rejects(captureResearch(b,'tab',options(dir)),/截图期间/);assert.deepEqual(await fs.readdir(dir),[]);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('capture 保留真实来源和摘要，拒绝覆盖同名证据',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pm-research-'));
 try{
 const b={evaluate:async()=>state,screenshot:async()=>png},o=options(dir);
 const r=await captureResearch(b,'tab',o);assert.equal(r.image.sha256,(await readImage(r.imageFile)).hash);assert.equal(r.url,state.url);assert.equal(r.viewport.width,390);
 const before=await fs.readFile(r.evidenceFile,'utf8');await assert.rejects(captureResearch(b,'tab',o),/证据已存在/);assert.equal(await fs.readFile(r.evidenceFile,'utf8'),before);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
