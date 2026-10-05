// Pure 2D sketch helpers. Coordinates are millimetres in the plate sketch frame.
export const line=(from,to)=>({kind:'line',from,to});
export const arc=(from,mid,to)=>({kind:'arc',from,mid,to});
export function placeContour(contour,center,matrix=[1,0,0,1]){
 const point=([x,y])=>[center[0]+matrix[0]*x+matrix[1]*y,center[1]+matrix[2]*x+matrix[3]*y];
 return contour.map(e=>({...e,from:point(e.from),to:point(e.to),...(e.mid?{mid:point(e.mid)}:{})}));
}
export function holeRow(start,step,count){
 if(!Number.isInteger(count)||count<1)throw Error('Hole count must be a positive integer');
 return Array.from({length:count},(_,i)=>[start[0]+step[0]*i,start[1]+step[1]*i]);
}
