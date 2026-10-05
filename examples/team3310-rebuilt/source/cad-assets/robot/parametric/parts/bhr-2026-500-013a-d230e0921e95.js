import {getEdges,getBounds,fillet,cut,compound,cylinder,unwrap} from 'brepjs';
import {buildPrismaticPart} from '../profile.js';

// BHR-2026-500-013A: pocketed rail with captive hex sockets and end screws.
// The stock contour preserves the curved mating envelope. The three reliefs
// leave a 3.175 mm floor and solid webs around the two captive nuts.
// Keep socket centers and the mating envelope fixed when sizing screw clearance.
export const parameters={holeScale:1,nutAcrossFlats:9.6012};
export const stockProfile={"origin":[0,-252.8731036,0],"normal":[0,1,0],"u":[0,0,1],"v":[1,0,0],"direction":[0,1,0],"depth":155.575,"outline":[{"kind":"arc","from":[164.2850847289,-73.3415885526],"mid":[163.1231772587,-72.6853839797],"to":[161.9690097479,-72.0156595825]},{"kind":"arc","from":[164.2850847289,-73.3415885526],"mid":[164.8811918037,-73.9241453125],"to":[165.1,-74.728408327]},{"kind":"line","from":[165.1,-107.5358676325],"to":[165.1,-74.728408327]},{"kind":"arc","from":[165.1,-107.5358676325],"mid":[164.8811918037,-108.340130647],"to":[164.2850847289,-108.9226874069]},{"kind":"arc","from":[161.969009748,-110.2486163769],"mid":[163.1231772586,-109.5788919797],"to":[164.2850847289,-108.9226874068]},{"kind":"arc","from":[161.969009748,-110.248616377],"mid":[155.5970816614,-110.2869511926],"to":[152.4,-104.775]},{"kind":"line","from":[152.4,-104.775],"to":[152.4,-77.4892759595]},{"kind":"arc","from":[152.4,-77.4892759595],"mid":[155.5970816613,-71.9773247669],"to":[161.969009748,-72.0156595825]}],"cutouts":[]};
export const reliefContours=[[
  {"kind":"line","from":[-104.3608676325,-141.2875],"to":[-98.2163287095,-141.2875]},
  {"kind":"arc","from":[-96.71369331,-142.3629032258],"mid":[-97.2924232433,-141.5840488237],"to":[-98.2163287095,-141.2875]},
  {"kind":"arc","from":[-96.71369331,-142.3629032258],"mid":[-88.8999892325,-147.955],"to":[-81.0862851551,-142.3629032258]},
  {"kind":"arc","from":[-79.5836497555,-141.2875],"mid":[-80.5075552218,-141.5840488237],"to":[-81.0862851551,-142.3629032258]},
  {"kind":"line","from":[-77.903408327,-141.2875],"to":[-79.5836497555,-141.2875]},
  {"kind":"arc","from":[-77.903408327,-141.2875],"mid":[-76.7808763118,-141.7524679849],"to":[-76.315908327,-142.875]},
  {"kind":"line","from":[-76.315908327,-212.725],"to":[-76.315908327,-142.875]},
  {"kind":"arc","from":[-77.903408327,-214.3125],"mid":[-76.7808763118,-213.8475320151],"to":[-76.315908327,-212.725]},
  {"kind":"line","from":[-77.903408327,-214.3125],"to":[-79.5836497555,-214.3125]},
  {"kind":"arc","from":[-81.0862851551,-213.2370967741],"mid":[-80.5075552218,-214.0159511762],"to":[-79.5836497555,-214.3125]},
  {"kind":"arc","from":[-81.0862851551,-213.2370967742],"mid":[-88.8999892325,-207.645],"to":[-96.71369331,-213.2370967742]},
  {"kind":"arc","from":[-98.2163287095,-214.3125],"mid":[-97.2924232432,-214.0159511762],"to":[-96.7136933099,-213.2370967741]},
  {"kind":"line","from":[-104.3608676325,-214.3125],"to":[-98.2163287095,-214.3125]},
  {"kind":"arc","from":[-105.9483676325,-212.725],"mid":[-105.4833996476,-213.8475320151],"to":[-104.3608676325,-214.3125]},
  {"kind":"line","from":[-105.9483676325,-212.725],"to":[-105.9483676325,-142.875]},
  {"kind":"arc","from":[-105.9483676325,-142.875],"mid":[-105.4833996476,-141.7524679849],"to":[-104.3608676325,-141.2875]},
],
[
  {"kind":"line","from":[-77.903408327,-109.9981036],"to":[-104.3608676325,-109.9981036]},
  {"kind":"arc","from":[-104.3608676325,-109.9981036],"mid":[-105.4833996476,-110.4630715849],"to":[-105.9483676325,-111.5856036]},
  {"kind":"line","from":[-105.9483676325,-136.525],"to":[-105.9483676325,-111.5856036]},
  {"kind":"arc","from":[-105.9483676325,-136.525],"mid":[-105.4833996476,-137.6475320151],"to":[-104.3608676325,-138.1125]},
  {"kind":"line","from":[-104.3608676325,-138.1125],"to":[-98.2163287095,-138.1125]},
  {"kind":"arc","from":[-98.2163287095,-138.1125],"mid":[-97.2924232432,-137.8159511762],"to":[-96.7136933099,-137.0370967741]},
  {"kind":"arc","from":[-81.0862851551,-137.0370967742],"mid":[-88.8999892325,-131.445],"to":[-96.71369331,-137.0370967742]},
  {"kind":"arc","from":[-81.0862851551,-137.0370967741],"mid":[-80.5075552218,-137.8159511762],"to":[-79.5836497555,-138.1125]},
  {"kind":"line","from":[-77.903408327,-138.1125],"to":[-79.5836497555,-138.1125]},
  {"kind":"arc","from":[-77.903408327,-138.1125],"mid":[-76.7808763118,-137.6475320151],"to":[-76.315908327,-136.525]},
  {"kind":"line","from":[-76.315908327,-136.525],"to":[-76.315908327,-111.5856036]},
  {"kind":"arc","from":[-77.903408327,-109.9981036],"mid":[-76.7808763118,-110.4630715849],"to":[-76.315908327,-111.5856036]},
],
[
  {"kind":"line","from":[-104.3608676325,-217.4875],"to":[-98.2163287095,-217.4875]},
  {"kind":"arc","from":[-96.71369331,-218.5629032258],"mid":[-97.2924232433,-217.7840488237],"to":[-98.2163287095,-217.4875]},
  {"kind":"arc","from":[-96.71369331,-218.5629032258],"mid":[-88.8999892325,-224.155],"to":[-81.0862851551,-218.5629032258]},
  {"kind":"arc","from":[-79.5836497555,-217.4875],"mid":[-80.5075552218,-217.7840488237],"to":[-81.0862851551,-218.5629032258]},
  {"kind":"line","from":[-77.903408327,-217.4875],"to":[-79.5836497555,-217.4875]},
  {"kind":"arc","from":[-77.903408327,-217.4875],"mid":[-76.7808763118,-217.9524679849],"to":[-76.315908327,-219.075]},
  {"kind":"line","from":[-76.315908327,-238.5856036],"to":[-76.315908327,-219.075]},
  {"kind":"arc","from":[-76.315908327,-238.5856036],"mid":[-76.7808763118,-239.7081356151],"to":[-77.903408327,-240.1731036]},
  {"kind":"line","from":[-104.3608676325,-240.1731036],"to":[-77.903408327,-240.1731036]},
  {"kind":"arc","from":[-105.9483676325,-238.5856036],"mid":[-105.4833996476,-239.7081356151],"to":[-104.3608676325,-240.1731036]},
  {"kind":"line","from":[-105.9483676325,-238.5856036],"to":[-105.9483676325,-219.075]},
  {"kind":"arc","from":[-105.9483676325,-219.075],"mid":[-105.4833996476,-217.9524679849],"to":[-104.3608676325,-217.4875]},
]];
export const nutCenters=[[-88.89998923252,-215.9],[-88.89998923252,-139.7]];
export const screwHoles=[{"radius":2.286,"at":[-84.78213797975,-97.29810359999999,158.75],"axis":[0,-1,0],"length":12.863266728220678},{"radius":2.286,"at":[-84.78213797975,-240.0111691829157,158.75],"axis":[0,-1,0],"length":12.861934417084285},{"radius":2.286,"at":[-97.48213797975,-97.29810359999999,158.75],"axis":[0,-1,0],"length":12.863266728220683},{"radius":2.286,"at":[-97.48213797975,-240.01116918291564,158.75],"axis":[0,-1,0],"length":12.861934417084342},{"radius":2.5908,"at":[-88.89998923252,-139.7,152.39999999999998],"axis":[0,0,1],"length":3.1750000000000007},{"radius":2.5908,"at":[-88.89998923252,-215.9,152.39999999999998],"axis":[0,0,1],"length":3.1750000000000007}];
const floor=155.575,top=165.1,floorRound=1.5875,lipRound=1.016;
const pocketProfile=outline=>({origin:[0,0,floor],normal:[0,0,1],u:[1,0,0],v:[0,1,0],direction:[0,0,1],depth:top-floor+.00001,outline,cutouts:[]});
const hexagon=(center,acrossFlats)=>{
 const r=acrossFlats/Math.sqrt(3),points=Array.from({length:6},(_,i)=>[center[0]+r*Math.cos(i*Math.PI/3),center[1]+r*Math.sin(i*Math.PI/3)]);
 return points.map((from,i)=>({kind:'line',from,to:points[(i+1)%6]}));
};
const edgesAt=(shape,z)=>getEdges(shape).filter(e=>{const b=getBounds(e);return Math.abs(b.zMin-z)<1e-5&&Math.abs(b.zMax-z)<1e-5;});
export default function build({holeScale=parameters.holeScale,nutAcrossFlats=parameters.nutAcrossFlats}={}){
 if(!Number.isFinite(holeScale)||holeScale<=0||!Number.isFinite(nutAcrossFlats)||nutAcrossFlats<=0)throw Error('Screw scale and nut width must be positive');
 let shape=buildPrismaticPart(stockProfile);
 for(const contour of reliefContours){
  let cutter=buildPrismaticPart(pocketProfile(contour));
  cutter=unwrap(fillet(cutter,edgesAt(cutter,floor),floorRound));
  shape=unwrap(cut(shape,cutter));
 }
 for(const center of nutCenters)shape=unwrap(cut(shape,buildPrismaticPart(pocketProfile(hexagon(center,nutAcrossFlats)))));
 // Round only pocket/socket mouths; the stock perimeter already contains its
 // mating radii. Long outer edges span the full stock length and are excluded.
 const y0=stockProfile.origin[1],y1=y0+stockProfile.depth;
 const mouths=edgesAt(shape,top).filter(e=>{const b=getBounds(e);return b.yMin>y0+1e-4&&b.yMax<y1-1e-4;});
 shape=unwrap(fillet(shape,mouths,lipRound));
 return unwrap(cut(shape,compound(screwHoles.map(h=>cylinder(h.radius*holeScale,h.length+.00002,{at:h.at.map((v,i)=>v-h.axis[i]*.00001),axis:h.axis})))));
}
