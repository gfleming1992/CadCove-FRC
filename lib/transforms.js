// Row-major rigid 3x4 matrices. Geometry lengths are metres in simulation.
export const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0];
export const translation=p=>[1,0,0,p[0],0,1,0,p[1],0,0,1,p[2]];
export function compose(a,b){const out=Array(12).fill(0);for(let r=0;r<3;r++)for(let c=0;c<4;c++){for(let k=0;k<3;k++)out[r*4+c]+=a[r*4+k]*b[k*4+c];if(c===3)out[r*4+c]+=a[r*4+3];}return out;}
export function inverse(m){const out=identity();for(let r=0;r<3;r++){for(let c=0;c<3;c++)out[r*4+c]=m[c*4+r];out[r*4+3]=-[0,1,2].reduce((s,k)=>s+out[r*4+k]*m[k*4+3],0);}return out;}
export const point=(m,p)=>[0,1,2].map(r=>m[r*4+3]+p.reduce((s,v,k)=>s+m[r*4+k]*v,0));
export const cadMetres=m=>m.map((v,i)=>i%4===3?v/1000:v);
export function rotation(axis,angle){const [x,y,z]=axis,s=Math.sin(angle),c=Math.cos(angle),t=1-c;return [t*x*x+c,t*x*y-s*z,t*x*z+s*y,0,t*x*y+s*z,t*y*y+c,t*y*z-s*x,0,t*x*z-s*y,t*y*z+s*x,t*z*z+c,0];}
export function quaternionMatrix([x,y,z,w],p=[0,0,0]){return [1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w),p[0],2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w),p[1],2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y),p[2]];}
export function axisAngle(m){
 // Robust matrix->quaternion conversion, including rotations close to pi.
 let x,y,z,w;const trace=m[0]+m[5]+m[10];
 if(trace>0){const s=2*Math.sqrt(trace+1);w=s/4;x=(m[9]-m[6])/s;y=(m[2]-m[8])/s;z=(m[4]-m[1])/s;}
 else if(m[0]>m[5]&&m[0]>m[10]){const s=2*Math.sqrt(1+m[0]-m[5]-m[10]);w=(m[9]-m[6])/s;x=s/4;y=(m[1]+m[4])/s;z=(m[2]+m[8])/s;}
 else if(m[5]>m[10]){const s=2*Math.sqrt(1+m[5]-m[0]-m[10]);w=(m[2]-m[8])/s;x=(m[1]+m[4])/s;y=s/4;z=(m[6]+m[9])/s;}
 else{const s=2*Math.sqrt(1+m[10]-m[0]-m[5]);w=(m[4]-m[1])/s;x=(m[2]+m[8])/s;y=(m[6]+m[9])/s;z=s/4;}
 const n=Math.hypot(x,y,z);if(n<1e-10)return [0,0,0];const a=2*Math.atan2(n,w);return [x*a/n,y*a/n,z*a/n];
}
export function bounds(instance,catalog){const b=catalog[instance.asset].bounds,m=cadMetres(instance.transform),low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];for(let c=0;c<8;c++){const p=point(m,[0,1,2].map(k=>((c>>k)&1?b.max[k]:b.min[k])/1000));for(let k=0;k<3;k++){low[k]=Math.min(low[k],p[k]);high[k]=Math.max(high[k],p[k]);}}return {low,high,center:low.map((v,i)=>(v+high[i])/2)};}
