import * as b from 'brepjs';import{buildPrismaticPart}from'../profile.js';
const polygon=(pts,origin,u,v,normal,direction,depth)=>buildPrismaticPart({origin,u,v,normal,direction,depth,outline:pts.map((p,i)=>({kind:'line',from:p,to:pts[(i+1)%pts.length]})),cutouts:[]});
export default function build(){const rearMode='split';
 const right=33.009909754405,step=-15.55489024559,top=546.1,floor=527.05,back=-327.9775,front=-292.1,tan=.06139299506993215/.9981136709595473;
 const left=z=>-37.77989024555+Math.tan(Math.PI/12)*(z-top),yb=z=>back+tan*(z-539.75);
 let s=polygon([[left(floor),floor],[right,floor],[right,top],[left(top),top]],[0,-400,0],[1,0,0],[0,0,1],[0,-1,0],[0,1,0],200);
 const backLimit=polygon((rearMode==='flat'?[[back,floor],[front,floor],[front,top],[back,top]]:rearMode==='slope'?[[yb(floor),floor],[front,floor],[front,top],[yb(top),top]]:[[yb(floor),floor],[front,floor],[front,top],[back,top],[back,539.75]]),[-100,0,0],[0,1,0],[0,0,1],[1,0,0],[1,0,0],200);s=b.unwrap(b.intersect(s,backLimit));
 s=b.unwrap(b.cut(s,b.cylinder(180.975,40,{at:[-162.5586951227,-173.4981036,520]})));
 const slope=.21089055584805164/.9775096794682393,backAt=x=>back+slope*(x-step),rearLimit=polygon([[-100,backAt(-100)],[100,backAt(100)],[100,front+1],[-100,front+1]],[0,0,520],[1,0,0],[0,1,0],[0,0,1],[0,0,1],40);s=b.unwrap(b.intersect(s,b.unwrap(b.fuse(rearLimit,b.box(200,200,40,{at:[step-100,-310,540]})))));
 s=b.unwrap(b.cut(s,b.box(100,100,533.4-520,{at:[step+50,-310,(533.4+520)/2]})));
 s=b.unwrap(b.cut(s,b.box(100,100,539.75-520,{at:[step+50,-367.5,(539.75+520)/2]})));
 return b.unwrap(b.simplify(s));
}
