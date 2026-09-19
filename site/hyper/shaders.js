export const vertex = `attribute vec2 a; varying vec2 uv; void main(){uv=a;gl_Position=vec4(a,0.,1.);}`;
export const fragment = `
#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#endif
precision highp float;
varying vec2 uv;
uniform vec2 resolution;
uniform vec4 player,forward,right,up,groundUp;
uniform int wrappedSky;
uniform int mode,count,view,colorMode,observerFollow;
uniform float radius,baseBlend,fov,rayStep,range,slice,rotation,orbit,elevation,observerDistance;
uniform vec4 centers[6],specs[6],tints[6];
uniform float operations[6],rotationActive[6];
uniform mat4 objectRotations[6];
struct Sample {float d;vec4 g;};
Sample primitive(vec4 p,float type,float r,float R,float soft){
 float rd=min(max(0.,soft)*.5,r*.45);if(type>3.5&&type<4.5)rd=min(rd,R*.8);
 if(type>2.5 && (type<3.5 || type>4.5)){
  vec4 ext=type>4.5?vec4(r,r,r,max(.12,r*.12)):vec4(r);rd=min(rd,min(min(ext.x,ext.y),min(ext.z,ext.w))*.8);
  vec4 q=abs(p)-ext+rd,o=max(q,0.);float l=length(o),m=max(max(q.x,q.y),max(q.z,q.w));vec4 g;
  if(l>.00001)g=o/l*sign(p);else if(q.x>=m)g=vec4(p.x<0.?-1.:1.,0.,0.,0.);else if(q.y>=m)g=vec4(0.,p.y<0.?-1.:1.,0.,0.);else if(q.z>=m)g=vec4(0.,0.,p.z<0.?-1.:1.,0.);else g=vec4(0.,0.,0.,p.w<0.?-1.:1.);
  return Sample(l+min(m,0.)-rd,g);
 }
 if(type>3.5 && type<4.5){float l=max(length(p.xzw),.00001),a=l-r+rd,b=abs(p.y)-R+rd;vec2 o=max(vec2(a,b),0.);float d=length(o);vec2 g=d>.00001?o/d:(a>=b?vec2(1.,0.):vec2(0.,1.));return Sample(d+min(max(a,b),0.)-rd,vec4(g.x*p.x/l,g.y*(p.y<0.?-1.:1.),g.x*p.z/l,g.x*p.w/l));}

 if(type<.5){float l=max(length(p),.00001);return Sample(l-r,p/l);}
 if(type<1.5){float l=max(length(p.xw),.00001);return Sample(l-r,vec4(p.x/l,0.,0.,p.w/l));}
 float l=max(length(p.xz),.00001),a=l-R,b=max(length(vec3(a,p.y,p.w)),.00001);return Sample(b-r,vec4(a*p.x/l/b,p.y/b,a*p.z/l/b,p.w/b));
}
Sample field(vec4 p){
 Sample a=Sample(p.w,vec4(0.,0.,0.,1.));
 if(mode>0&&mode<4)a=primitive(p,float(mode-1),mode==3?1.3:radius,2.8,0.);
 if(mode==4){
  float rr=max(length(p.xyz),.00001);Sample sheet=Sample(abs(p.w)-2.5,vec4(0.,0.,0.,p.w<0.?-1.:1.)),neck=Sample(radius-rr,vec4(-p.xyz/rr,0.));
  float k=max(.05,baseBlend),h=clamp(.5+.5*(sheet.d-neck.d)/k,0.,1.);
  a=Sample(mix(neck.d,sheet.d,h)+k*h*(1.-h),mix(neck.g,sheet.g,h));
 }
 for(int i=0;i<6;i++){
  if(i>=count)break;
  vec4 q=p-centers[i];
  if(rotationActive[i]>.5){mat4 m=objectRotations[i];q=vec4(dot(m[0],q),dot(m[1],q),dot(m[2],q),dot(m[3],q));}
  Sample b=primitive(q,specs[i].x,specs[i].y,specs[i].z,specs[i].w);
  if(rotationActive[i]>.5)b.g=objectRotations[i]*b.g;
  if(operations[i]>.5)a=Sample(-a.d,-a.g);
  float k=specs[i].w,h=clamp(.5+.5*(b.d-a.d)/k,0.,1.);
  a=Sample(mix(b.d,a.d,h)-k*h*(1.-h),mix(b.g,a.g,h));
  if(operations[i]>.5)a=Sample(-a.d,-a.g);
 }return a;
}
vec4 normal(vec4 p){return normalize(field(p).g);}
vec4 tangent(vec4 a,vec4 n){return a-n*dot(a,n);}
vec4 project(vec4 p){for(int j=0;j<2;j++){Sample s=field(p);p-=s.g*s.d/max(dot(s.g,s.g),.00001);}return p;}
// Refine a floor crossing while holding Y fixed. Shading an off-manifold linear
// interpolation caused unstable curvature and the broken horizontal fragments.
vec4 projectFloor(vec4 p,float y){p.y=y;for(int j=0;j<3;j++){Sample s=field(p);vec4 g=s.g;g.y=0.;p-=g*s.d/max(dot(g,g),.00001);p.y=y;}return p;}
float curve(vec4 p){
 vec4 n=normal(p),a=vec4(1.,0.,0.,0.);if(abs(n.x)>.8)a=vec4(0.,1.,0.,0.);a=normalize(tangent(a,n));
 vec4 b=vec4(0.,0.,1.,0.);b=tangent(b,n);b-=a*dot(a,b);if(length(b)<.1){b=tangent(vec4(0.,0.,0.,1.),n);b-=a*dot(a,b);}b=normalize(b);
 vec4 c=vec4(0.,1.,0.,0.);c=tangent(c,n)-a*dot(a,c)-b*dot(b,c);if(length(c)<.1){c=vec4(1.,0.,0.,0.);c=tangent(c,n)-a*dot(a,c)-b*dot(b,c);}if(length(c)<.1){c=vec4(0.,0.,0.,1.);c=tangent(c,n)-a*dot(a,c)-b*dot(b,c);}c=normalize(c);
 float e=.008;vec4 A=(normal(p+a*e)-normal(p-a*e))/(2.*e),B=(normal(p+b*e)-normal(p-b*e))/(2.*e),C=(normal(p+c*e)-normal(p-c*e))/(2.*e);
 float tr=dot(A,a)+dot(B,b)+dot(C,c);float sq=dot(A,a)*dot(A,a)+dot(B,b)*dot(B,b)+dot(C,c)*dot(C,c)+2.*(dot(A,b)*dot(B,a)+dot(A,c)*dot(C,a)+dot(B,c)*dot(C,b));return (tr*tr-sq)/6.;
}
vec3 palette(vec4 p){float k=curve(p);vec3 gray=vec3(.59,.64,.63),orange=vec3(1.,.43,.06),blue=vec3(.025,.58,.94);if(colorMode==1){float best=1e5;for(int i=0;i<6;i++){if(i>=count)break;if(operations[i]>.5)continue;float d=length(p-centers[i])-specs[i].y;if(d<best){best=d;gray=tints[i].xyz;}}return gray;}return mix(gray,k>0.?orange:blue,smoothstep(.002,.08,abs(k)));}
// Explicit ray footprints avoid derivatives inside divergent tracing loops.
vec3 shade(vec4 p,float light,float footprint){
 vec2 q=fract(p.xz*1.8)-.5;float edge=max(abs(q.x),abs(q.y));
 // Analytic pixel footprint: crisp nearby squares, stable filtering in the distance.
 // This sharpens the pattern without changing the curvature colour gradient.
 float aa=clamp(footprint*1.25,.012,.30);
 float tile=1.-smoothstep(.385-aa,.385+aa,edge);
 float contrast=1.-smoothstep(.16,.62,footprint*1.35);
 return palette(p)*(light+.055+(tile-.5)*.15*contrast);
}
vec3 sky(vec4 v){return mix(vec3(.76,.83,.84),vec3(.29,.43,.52),clamp(v.y*.65+.45,0.,1.));}
vec4 slicePoint(vec3 p){vec4 q=vec4(p.x,slice,p.z,p.y);float c=cos(rotation),s=sin(rotation);q.xw=mat2(c,-s,s,c)*q.xw;return q;}
void main(){vec2 xy=uv*vec2(resolution.x/resolution.y,1.);vec3 col;
 if(view==0){
  vec4 p=player,v=normalize(forward+tan(fov*.5)*(right*xy.x+up*xy.y));float travel=0.,floorY=mode==3?-.7:-1.45;col=sky(v);bool hit=false;bool allowFloor=wrappedSky==1||dot(v,groundUp)<=0.;vec4 nOld=normal(p);
  if(allowFloor)for(int i=0;i<224;i++){
   if(travel>range)break;
   vec4 old=p;float ds=rayStep;vec4 q=p,n=nOld;bool accepted=false;
   // Adaptive retries keep rays on the local branch instead of leaving sky-coloured gaps.
   for(int retry=0;retry<6;retry++){
    vec4 proposal=old+v*ds;q=project(proposal);Sample a=field(q);
    if(length(q-proposal)<max(ds*.92,.002)&&abs(a.d)<.008&&dot(a.g,a.g)>.000001){n=normalize(a.g);accepted=true;break;}
    ds*=.5;
   }
   if(!accepted)break;
   p=q;float den=max(.08,1.+dot(nOld,n));v=normalize(v-(nOld+n)*(dot(v,n)/den));nOld=n;travel+=ds;
   if(travel>1.2&&length(p-player)<.20){col=vec3(.95,.025,.055);hit=true;break;}
   if(old.y>floorY && p.y<=floorY){
    // Interpolate within the accepted, short segment. A second independent
    // ground projection used to jump branches and punch holes in the floor.
    float h=clamp((floorY-old.y)/(p.y-old.y),0.,1.);vec4 linearHit=mix(old,p,h),floorHit=projectFloor(linearHit,floorY);Sample floorSample=field(floorHit);
    if(length(floorHit-linearHit)<max(ds*1.25,.01)&&abs(floorSample.d)<.008)p=floorHit;else p=linearHit;
    float footprint=travel*2.*tan(fov*.5)/resolution.y/max(.15,abs(v.y));
    col=shade(p,.83,footprint);hit=true;break;
   }
  }

  if(hit)col=mix(col,sky(v),1.-exp(-travel*.018));
 }else{
  float rc=cos(rotation),rs=sin(rotation);vec3 followed=vec3(rc*player.x-rs*player.w,rs*player.x+rc*player.w,player.z);vec3 target=observerFollow==1?followed:vec3(0.,.8,1.),eye=target+observerDistance*vec3(sin(orbit)*cos(elevation),sin(elevation),-cos(orbit)*cos(elevation));vec3 f=normalize(target-eye),r=normalize(cross(f,vec3(0.,1.,0.))),u=cross(r,f),v=normalize(f+xy.x*r*.55+xy.y*u*.55),p=eye;float t=0.;col=vec3(.12,.17,.21);
  for(int i=0;i<180;i++){p=eye+v*t;vec4 q=slicePoint(p);Sample a=field(q);float d=abs(a.d);if(d<.012){float e=.01;vec3 n=normalize(vec3(field(slicePoint(p+vec3(e,0.,0.))).d-field(slicePoint(p-vec3(e,0.,0.))).d,field(slicePoint(p+vec3(0.,e,0.))).d-field(slicePoint(p-vec3(0.,e,0.))).d,field(slicePoint(p+vec3(0.,0.,e))).d-field(slicePoint(p-vec3(0.,0.,e))).d));col=shade(q,.55+.35*abs(dot(n,normalize(vec3(-.4,1.,-.7)))),t*1.1/resolution.y/max(.15,abs(dot(n,v))));if(length(q-player)<.25)col=vec3(1.,.03,.06);col=mix(col,vec3(.12,.17,.21),1.-exp(-t*.013));break;}t+=max(.008,d*.72);if(t>80.)break;}
 }
 gl_FragColor=vec4(pow(max(col,vec3(0.)),vec3(.92)),1.);
}`;
