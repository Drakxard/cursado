type Camera = {x:number;y:number;zoom:number}

/** Coalesce wheel bursts and ease mouse-wheel steps without delaying trackpad panning. */
export function wheelCamera(read:()=>Camera,paint:()=>void) {
  let frame:number|undefined,lastTime:number|undefined
  let camera:Camera|undefined,target:Camera|undefined
  const tick=(time:number)=>{
    frame=undefined
    if(camera!==read()){target=undefined;lastTime=undefined;return}
    if(target&&camera){
      const elapsed=lastTime===undefined?16:Math.max(1,time-lastTime)
      const alpha=1-Math.exp(-elapsed/32)
      camera.x+=(target.x-camera.x)*alpha
      camera.y+=(target.y-camera.y)*alpha
      camera.zoom+=(target.zoom-camera.zoom)*alpha
      if(Math.abs(Math.log(target.zoom/camera.zoom))<.0005&&Math.hypot(target.x-camera.x,target.y-camera.y)<.1){
        Object.assign(camera,target);target=undefined
      }
    }
    lastTime=time
    paint()
    if(target)frame=requestAnimationFrame(tick)
    else lastTime=undefined
  }
  function schedule(){if(frame===undefined)frame=requestAnimationFrame(tick)}
  function cancel(){
    if(frame!==undefined)cancelAnimationFrame(frame)
    frame=undefined;target=undefined;lastTime=undefined;camera=undefined
  }
  return {
    zoom(delta:number,x:number,y:number){
      const current=read()
      if(camera!==current){cancel();camera=current}
      target??={...current}
      // A single mouse notch must not jump by 50%; tiny pinch deltas stay precise.
      const next=Math.min(5,Math.max(.01,target.zoom*Math.exp(-Math.max(-100,Math.min(100,delta))*.002)))
      const ratio=next/target.zoom
      target.x=x-(x-target.x)*ratio;target.y=y-(y-target.y)*ratio;target.zoom=next
      schedule()
    },
    pan(dx:number,dy:number){
      target=undefined;lastTime=undefined;camera=read()
      camera.x-=dx;camera.y-=dy
      schedule()
    },
    cancel,
  }
}
