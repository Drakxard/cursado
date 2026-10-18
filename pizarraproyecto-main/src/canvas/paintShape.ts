import { paintVisual, paintLabel } from './visualRendering'
import type { ShapeItem, ResolveObject } from './visualObjects'
export function paintShape(ctx: CanvasRenderingContext2D, shape: ShapeItem, resolve: ResolveObject, color=shape.color, dark=false, minimumWidth=0) {
    const {x, y, width: w, height: h, kind} = shape
    ctx.save()
    if (shape.rotation) {
      const center = {x:x+w/2,y:y+h/2}
      ctx.translate(center.x,center.y);ctx.rotate(shape.rotation);ctx.translate(-center.x,-center.y)
    }
    if(shape.visualType==='pdf-shortcut') {
      ctx.fillStyle=dark?'#1e293b':'#eff6ff';ctx.strokeStyle=dark?'#93c5fd':'#2563eb';ctx.lineWidth=1.5
      ctx.beginPath();ctx.roundRect(x,y,w,h,Math.min(12,h/4));ctx.fill();ctx.stroke()
      ctx.fillStyle=dark?'#dbeafe':'#1e40af';ctx.font=`${Math.min(18,h*.35)}px system-ui`;ctx.textBaseline='middle'
      let label=shape.label??'PDF'
      while(label.length>1&&ctx.measureText(label).width>w-28)label=label.slice(0,-2)+'…'
      ctx.fillText(label,x+14,y+h/2);ctx.restore();return
    }
    if(paintVisual(ctx,shape,resolve,color,dark)){ctx.restore();return}
    ctx.strokeStyle = color
    ctx.lineWidth = Math.max(shape.strokeWidth, minimumWidth)
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'
    ctx.beginPath()
    if (kind === 'line' || kind === 'arrow' || kind === 'double-arrow') {
      const leftY=shape.reverse?y:y+h, rightY=shape.reverse?y+h:y
      const x1=shape.backwards?x+w:x, y1=shape.backwards?rightY:leftY
      const x2=shape.backwards?x:x+w, y2=shape.backwards?leftY:rightY
      ctx.moveTo(x1,y1);ctx.lineTo(x2,y2)
      const angle=Math.atan2(y2-y1,x2-x1), head=Math.min(19,Math.max(9,Math.min(Math.abs(w),Math.abs(h))*.23))
      if (kind !== 'line') {
        ctx.moveTo(x2-head*Math.cos(angle-.55),y2-head*Math.sin(angle-.55));ctx.lineTo(x2,y2)
        ctx.lineTo(x2-head*Math.cos(angle+.55),y2-head*Math.sin(angle+.55))
      }
      if(kind==='double-arrow'){
        ctx.moveTo(x1+head*Math.cos(angle-.55),y1+head*Math.sin(angle-.55));ctx.lineTo(x1,y1)
        ctx.lineTo(x1+head*Math.cos(angle+.55),y1+head*Math.sin(angle+.55))
      }
    } else if(kind==='rectangle') ctx.rect(x,y,w,h)
    else if(kind==='rounded') ctx.roundRect(x,y,w,h,Math.max(3,Math.min(18,w*.15,h*.15)))
    else if(kind==='circle'||kind==='ellipse') ctx.ellipse(x+w/2,y+h/2,Math.max(.2,kind==='circle'?Math.min(w,h)/2:w/2),Math.max(.2,kind==='circle'?Math.min(w,h)/2:h/2),0,0,Math.PI*2)
    else if(kind==='diamond') { ctx.moveTo(x+w/2,y);ctx.lineTo(x+w,y+h/2);ctx.lineTo(x+w/2,y+h);ctx.lineTo(x,y+h/2);ctx.closePath() }
    else if(kind==='triangle'||kind==='triangle-down') {
      ctx.moveTo(x+w/2,kind==='triangle'?y:y+h)
      ctx.lineTo(x+w,kind==='triangle'?y+h:y);ctx.lineTo(x,kind==='triangle'?y+h:y);ctx.closePath()
    } else if(kind==='hexagon') {
      ctx.moveTo(x+w*.25,y);ctx.lineTo(x+w*.75,y);ctx.lineTo(x+w,y+h/2)
      ctx.lineTo(x+w*.75,y+h);ctx.lineTo(x+w*.25,y+h);ctx.lineTo(x,y+h/2);ctx.closePath()
    } else if(kind==='cylinder') {
      const ry=Math.max(4,Math.min(h*.18,22))
      ctx.ellipse(x+w/2,y+ry,w/2,ry,0,Math.PI,0)
      ctx.moveTo(x,y+ry);ctx.lineTo(x,y+h-ry)
      ctx.ellipse(x+w/2,y+h-ry,w/2,ry,0,0,Math.PI*2)
      ctx.moveTo(x+w,y+h-ry);ctx.lineTo(x+w,y+ry)
      ctx.moveTo(x+w,y+ry);ctx.ellipse(x+w/2,y+ry,w/2,ry,0,0,Math.PI)
    }
    ctx.stroke();paintLabel(ctx,shape,color);ctx.restore()
  }
