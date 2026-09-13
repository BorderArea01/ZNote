import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ImageSwipe,ZoomGesture,initialZoom,zoomAt,boundZoom} from '../src/image-gestures.js';
const bounds={width:400,height:400,imageWidth:400,imageHeight:400};
test('pinch retains its image anchor, continues as a pan without jumps and never closes after multitouch',()=>{
  assert.deepEqual(zoomAt(initialZoom(),3,{x:60,y:20},bounds),{scale:3,x:-120,y:-40});
  const gesture=new ZoomGesture(bounds);gesture.down(1,{x:0,y:20},true);gesture.down(2,{x:100,y:20},true);gesture.move(1,{x:-50,y:20});gesture.move(2,{x:150,y:20});assert.deepEqual(gesture.view,{scale:2,x:-50,y:-20});
  const before={...gesture.view};assert.equal(gesture.up(2,{x:150,y:20},true),false);assert.deepEqual(gesture.view,before);gesture.move(1,{x:-30,y:40});assert.deepEqual(gesture.view,{scale:2,x:-30,y:0});assert.equal(gesture.up(1,{x:-30,y:40},true),false);
  gesture.down(3,{x:1,y:1},true);assert.equal(gesture.up(3,{x:1,y:1},true),true);
  gesture.down(4,{x:1,y:1},true);gesture.move(4,{x:60,y:1});gesture.move(4,{x:1,y:1});assert.equal(gesture.up(4,{x:1,y:1},true),false,'moving out and back is a drag, not an outside tap');
  gesture.down(5,{x:1,y:1},true);assert.equal(gesture.up(5,{x:1,y:1},true,true),false);assert.equal(gesture.points.size,0);
});
test('zoom limits and panning bounds keep images reachable through resizing and third pointers',()=>{
  assert.deepEqual(boundZoom({scale:100,x:1e9,y:-1e9},bounds),{scale:8,x:1400,y:-1400});assert.deepEqual(boundZoom({scale:.001,x:500,y:100},bounds),{scale:.25,x:0,y:0});
  const g=new ZoomGesture(bounds);g.set({scale:3,x:100,y:100});g.down(1,{x:-40,y:0});g.down(2,{x:40,y:0});const before={...g.view};g.down(3,{x:0,y:100});g.move(3,{x:0,y:200});assert.deepEqual(g.view,before);g.up(3,{x:0,y:200});assert.deepEqual(g.view,before);
  g.resize({width:1000,height:1000,imageWidth:200,imageHeight:200});assert.deepEqual(g.view,{scale:3,x:0,y:0});assert.equal(g.points.size,0);assert.deepEqual(g.move(1,{x:999,y:999}),g.view);
});
test('image swipe recognizes single horizontal gestures, suppresses ghost clicks and leaves vertical or multi-touch gestures alone',()=>{
  const g=new ImageSwipe();g.down(1,{x:250,y:100},300);assert.equal(g.up(1,{x:80,y:105}),1);assert.equal(g.suppressClick,true);assert.equal(g.tapped,false);
  g.down(2,{x:80,y:100},300);assert.equal(g.up(2,{x:250,y:100}),-1);g.down(3,{x:100,y:100},300);assert.equal(g.up(3,{x:104,y:105}),0);assert.equal(g.suppressClick,false);assert.equal(g.tapped,true);
  g.down(4,{x:100,y:100},300);g.move(4,{x:105,y:160});assert.equal(g.up(4,{x:260,y:165}),0);assert.equal(g.suppressClick,true);
  g.down(5,{x:100,y:100},300);g.down(6,{x:200,y:100},300);assert.equal(g.up(5,{x:0,y:100}),0);assert.equal(g.up(6,{x:260,y:100}),0);assert.equal(g.suppressClick,true);
  g.down(7,{x:250,y:100},300);assert.equal(g.up(7,{x:0,y:100},true),0);assert.equal(g.tapped,false);g.down(8,{x:250,y:100},300);g.cancel();assert.equal(g.up(8,{x:0,y:100}),0);assert.equal(g.tapped,false);
});
