// SPDX-License-Identifier: MIT
// Numeric transport only. Public JSON validation and IDs live in solver.py.
#include <iostream>
#include <iomanip>
#include <fstream>
#include <sstream>

#include <cmath>
#include <stdexcept>
#include "ASMTAssembly.h"
#include "ASMTPart.h"
#include "ASMTMarker.h"
#include "ASMTFixedJoint.h"
#include "ASMTRevoluteJoint.h"
#include "ASMTTranslationalJoint.h"
#include "ASMTGearJoint.h"
#include "ASMTRotationalMotion.h"
#include "ASMTTranslationalMotion.h"
#include "CREATE.h"
using namespace MbD;
double number(){double x;if(!(std::cin>>x)||!std::isfinite(x))throw std::runtime_error("Invalid numeric input");return x;}
int integer(int low,int high){double n=number();if(n<low||n>high||std::floor(n)!=n)throw std::runtime_error("Invalid index/count");return int(n);}
void pose(std::shared_ptr<ASMTSpatialItem> item){
 double v[12];for(double &x:v)x=number();
 item->setPosition3D(v[0],v[1],v[2]);
 item->setRotationMatrix(v[3],v[4],v[5],v[6],v[7],v[8],v[9],v[10],v[11]);
}
int main(int argc,char**argv){
 // Upstream emits diagnostics on cout. Keep them off our result channel.
 std::cout.rdbuf(std::cerr.rdbuf());
 try{
  if(argc!=2)throw std::runtime_error("Usage: cadcove-ondsel OUTPUT");
  if(integer(2,2)!=2)throw std::runtime_error("Protocol version");
  int nb=integer(1,512),nj=integer(1,2048),nd=integer(0,128),ng=integer(0,128);
  double duration=number(),dt=number();
  if(duration<0||duration>300||dt<=0||dt>1||duration/dt>10000)throw std::runtime_error("Invalid timing");
  auto assembly=CREATE<ASMTAssembly>::With();assembly->setName("mechanism");
  std::vector<std::shared_ptr<ASMTPart>> bodies;
  for(int i=0;i<nb;i++){
   bool fixed=integer(0,1);auto body=CREATE<ASMTPart>::With();body->setName("b"+std::to_string(i));pose(body);assembly->addPart(body);bodies.push_back(body);
   if(fixed){
    auto a=CREATE<ASMTMarker>::With(),b=CREATE<ASMTMarker>::With();a->setName("ground"+std::to_string(i));b->setName("ground");
    a->setPosition3D(body->position3D);a->setRotationMatrix(body->rotationMatrix);assembly->addMarker(a);body->addMarker(b);
    auto j=CREATE<ASMTFixedJoint>::With();j->setName("ground"+std::to_string(i));j->setMarkerI("/mechanism/"+a->name);j->setMarkerJ("/mechanism/"+body->name+"/ground");assembly->addJoint(j);
   }
  }
  std::vector<int> types;
  std::vector<std::string> parents,children;
  for(int i=0;i<nj;i++){
   int type=integer(0,2);types.push_back(type);int ia=integer(0,nb-1),ib=integer(0,nb-1);if(ia==ib)throw std::runtime_error("Self mate");
   auto a=CREATE<ASMTMarker>::With(),b=CREATE<ASMTMarker>::With();a->setName("a"+std::to_string(i));b->setName("b"+std::to_string(i));pose(a);pose(b);bodies[ia]->addMarker(a);bodies[ib]->addMarker(b);
   std::shared_ptr<ASMTJoint> joint;
   if(type==0)joint=CREATE<ASMTFixedJoint>::With();else if(type==1)joint=CREATE<ASMTRevoluteJoint>::With();else joint=CREATE<ASMTTranslationalJoint>::With();
   joint->setName("j"+std::to_string(i));joint->setMarkerI("/mechanism/"+bodies[ia]->name+"/"+a->name);joint->setMarkerJ("/mechanism/"+bodies[ib]->name+"/"+b->name);assembly->addJoint(joint);
   parents.push_back("/mechanism/"+bodies[ia]->name+"/"+a->name);children.push_back("/mechanism/"+bodies[ib]->name+"/"+b->name);
  }
  for(int i=0;i<ng;i++){
   int driver=integer(0,nj-1),follower=integer(0,nj-1);double ri=number(),rj=number();
   if(types[driver]!=1||types[follower]!=1||ri==0||rj==0)throw std::runtime_error("Invalid gear coupling");
   auto gear=CREATE<ASMTGearJoint>::With();gear->setName("coupling"+std::to_string(i));
   gear->setMarkerI(children[driver]);gear->setMarkerJ(children[follower]);gear->setMarkerK(parents[driver]);gear->radiusI=ri;gear->radiusJ=rj;assembly->addJoint(gear);
  }
  for(int i=0;i<nd;i++){
   int joint=integer(0,nj-1);double p=number(),v=number(),a=number(),j=number();
   std::ostringstream expr;expr<<std::setprecision(17)<<"("<<p<<")+("<<v<<")*time+("<<a/2<<")*time^2+("<<j/6<<")*time^3";
   if(types[joint]==1){auto m=CREATE<ASMTRotationalMotion>::With();m->setName("d"+std::to_string(i));m->setMotionJoint("/mechanism/j"+std::to_string(joint));m->setRotationZ(expr.str());assembly->addMotion(m);}
   else if(types[joint]==2){auto m=CREATE<ASMTTranslationalMotion>::With();m->setName("d"+std::to_string(i));m->motionJoint="/mechanism/j"+std::to_string(joint);m->setTranslationZ(expr.str());assembly->addMotion(m);}
   else throw std::runtime_error("Cannot drive fixed mate");
  }
  std::string extra;if(std::cin>>extra)throw std::runtime_error("Unexpected input");
  auto params=CREATE<ASMTSimulationParameters>::With();params->settstart(0);params->settend(duration);params->sethout(dt);params->sethmax(dt);params->sethmin(1e-9);params->seterrorTol(1e-9);assembly->setSimulationParameters(params);
  assembly->runKINEMATIC();
  // Upstream catches SimulationStoppingError internally; incomplete runs fail.
  if(assembly->times->empty()||std::abs(assembly->times->back()-duration)>1e-6)throw std::runtime_error("Solver stopped before requested end time");
  std::ofstream out(argv[1]);if(!out)throw std::runtime_error("Cannot open result");out<<std::setprecision(17)<<"{\"frames\":[";
  bool emitted=false;
  for(size_t f=0;f<assembly->times->size();f++){
   // Ondsel records the input seed and assembled state at t=0. Use the latter.
   if(f+1<assembly->times->size() && assembly->times->at(f+1)==assembly->times->at(f))continue;
   if(emitted)out<<",";emitted=true;out<<"{\"time\":"<<assembly->times->at(f)<<",\"poses\":[";
   for(int b=0;b<nb;b++){
    if(b)out<<",";auto p=bodies[b]->getPosition3D(f);auto r=bodies[b]->getRotationMatrix(f);
    out<<"[";for(int col=0;col<4;col++)for(int row=0;row<4;row++){
     if(col||row)out<<",";double value=row==3?(col==3?1:0):(col==3?p->at(row):r->at(row)->at(col));
     if(!std::isfinite(value))throw std::runtime_error("Nonfinite solved pose");out<<value;
    }out<<"]";
   }out<<"]}";
  }out<<"]}\n";if(!out)throw std::runtime_error("Result write failed");return 0;
 }catch(const std::exception& e){std::cerr<<"Bridge failure: "<<e.what()<<"\n";return 1;}catch(...){std::cerr<<"Unknown solver failure\n";return 1;}
}
