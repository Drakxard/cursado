import type { Point } from '../storage/database'
import type { ShapeItem } from './visualObjects'

export function createReviewMarker(id:string,point:Point):ShapeItem {
  return {id,kind:'circle',visualType:'review-marker',x:point.x-28,y:point.y-28,width:56,height:56,color:'#202020',strokeWidth:3.5}
}

/** Stable creation order, independent of marker position and camera zoom. */
export function adjacentReviewMarker(shapes:ShapeItem[],id:string,direction:-1|1):ShapeItem|null {
  const markers=shapes.filter(item=>item.visualType==='review-marker')
  const index=markers.findIndex(item=>item.id===id)
  if(index<0||!markers.length)return null
  return markers[(index+direction+markers.length)%markers.length]
}
