import {afterEach,expect,it,vi} from 'vitest'
import {wheelCamera} from '../src/canvas/wheelCamera'

afterEach(()=>vi.unstubAllGlobals())
function setup(){
  let id=0,time=0,camera={x:40,y:-20,zoom:1}
  const frames=new Map<number,FrameRequestCallback>(),paint=vi.fn()
  vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>{frames.set(++id,fn);return id})
  vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id))
  return {motion:wheelCamera(()=>camera,paint),paint,frames,get camera(){return camera},
    replace(){camera={x:0,y:0,zoom:1}},
    step(){const pending=[...frames.values()];frames.clear();time+=16;pending.forEach(fn=>fn(time))}}
}

it('coalesces wheel bursts and keeps the cursor anchored throughout easing',()=>{
  const s=setup(),x=420,y=300,world={x:(x-s.camera.x)/s.camera.zoom,y:(y-s.camera.y)/s.camera.zoom}
  for(let i=0;i<12;i++)s.motion.zoom(-10,x,y)
  expect(s.frames.size).toBe(1);expect(s.paint).not.toHaveBeenCalled()
  for(let i=0;i<30;i++){
    s.step()
    expect((x-s.camera.x)/s.camera.zoom).toBeCloseTo(world.x,8)
    expect((y-s.camera.y)/s.camera.zoom).toBeCloseTo(world.y,8)
  }
  expect(s.camera.zoom).toBeCloseTo(Math.exp(.24),8)
  expect(s.frames.size).toBe(0)
})

it('pans without losing events and cancels a pending zoom when interacting or changing boards',()=>{
  const s=setup()
  for(let i=0;i<10;i++)s.motion.pan(2,3)
  s.step();expect(s.paint).toHaveBeenCalledTimes(1)
  expect(s.camera).toEqual({x:20,y:-50,zoom:1})
  s.motion.zoom(-100,200,200);s.motion.cancel();s.step()
  expect(s.camera.zoom).toBe(1)
  s.motion.zoom(-100,200,200);s.replace();s.step()
  expect(s.camera).toEqual({x:0,y:0,zoom:1})
  expect(s.frames.size).toBe(0)
})

it('clamps extreme wheel bursts to the supported zoom range',()=>{
  const s=setup()
  for(const [delta,expected] of [[-10000,5],[10000,.01]]){
    for(let i=0;i<60;i++)s.motion.zoom(delta,200,200)
    for(let i=0;i<60;i++)s.step()
    expect(s.camera.zoom).toBe(expected)
    expect(Number.isFinite(s.camera.x)&&Number.isFinite(s.camera.y)).toBe(true)
  }
})
