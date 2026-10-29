// GLSL。three の ShaderMaterial に渡す。座標は筒の座標（半径1）をそのまま clip 空間に置く。

const NOISE = /* glsl */ `
float hash11(float p){ p = fract(p*.1031); p *= p+33.33; p *= p+p; return fract(p); }
float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),u.x), mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=mat2(1.6,1.2,-1.2,1.6)*p; a*=.5; } return s; }
mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,s,-s,c); }
`;

export const beadVert = /* glsl */ `
attribute vec4 iPos;   // x, y, r, angle
attribute vec4 iCol;   // rgb, kind
attribute vec4 iMisc;  // seed, photo, born, -
uniform float uScale;  // 筒→画面の拡大（タイル描画用）
uniform vec2 uOffset;
varying vec2 vQ;
varying vec4 vCol;
varying vec4 vMisc;
varying float vA;
void main(){
  float pad = iCol.w > 4.5 && iCol.w < 5.5 ? 1.2 : 1.32;
  vQ = position.xy * pad;
  vCol = iCol; vMisc = iMisc; vA = iPos.w;
  vec2 p = iPos.xy + position.xy * pad * iPos.z;
  gl_Position = vec4((p + uOffset) * uScale, 0., 1.);
}
`;

export const beadFrag = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uCellAngle;
uniform sampler2D uPhoto;
uniform vec4 uPhotoRect[24];
varying vec2 vQ;
varying vec4 vCol;
varying vec4 vMisc;
varying float vA;
${NOISE}

vec3 rainbow(float t){ return .5+.5*cos(6.2831*(t+vec3(0.,.33,.67))); }

// 多角形の距離（頂点は種から作る）
float shard(vec2 q, float seed, int n, out float facet, out float seam){
  vec2 c = (vec2(hash11(seed*3.1), hash11(seed*7.7))-.5)*.35;
  float ang = atan(q.y-c.y, q.x-c.x);
  float stp = 6.2831853/float(n);
  float fi = floor((ang+3.14159265)/stp);
  facet = fi;
  float a0 = -3.14159265 + fi*stp, a1 = a0 + stp;
  float r0 = .62 + .36*hash11(seed*13. + fi), r1 = .62 + .36*hash11(seed*13. + mod(fi+1., float(n)));
  vec2 v0 = vec2(cos(a0),sin(a0))*r0, v1 = vec2(cos(a1),sin(a1))*r1;
  vec2 e = v1-v0; vec2 nrm = normalize(vec2(e.y,-e.x));
  float d = dot(q-v0, nrm); // 外向き正
  // 面の継ぎ目（中心から頂点への線）までの距離
  vec2 dq = q - c;
  float s0 = abs(dot(dq, normalize(vec2(-sin(a0), cos(a0)))));
  float s1 = abs(dot(dq, normalize(vec2(-sin(a1), cos(a1)))));
  seam = min(s0, s1);
  return d;
}

void main(){
  float kind = vCol.w;
  float seed = vMisc.x;
  vec3 col = vCol.rgb;
  vec2 q0 = vQ;                       // 筒の向きのまま
  vec2 q = rot(-vA) * vQ;             // 粒の向き
  vec3 L = normalize(vec3(rot(-uCellAngle)*vec2(-.45,.55), .7)); // 画面に固定された光
  float d = length(q0);
  float aa = fwidth(d)*1.2;
  vec3 o = vec3(0.); float a = 0.;

  if(kind < .5){
    // ガラス玉：後ろから光を受け、中心が明るく、縁が暗い
    float cov = 1.-smoothstep(1.-aa, 1.+aa, d);
    float z = sqrt(max(0., 1.-d*d));
    vec3 n = vec3(q0, z);
    vec3 body = col * (.05 + 1.25*pow(z, 2.6));
    vec2 cp = -L.xy*.42;
    body += col * 1.1 * exp(-dot(q0-cp,q0-cp)*12.);
    body += mix(col, vec3(1.), .5) * 1.4 * exp(-pow((length(q0-cp*.6)-.62)*9., 2.)) * .5;
    // 中のリボン（キャッツアイ）
    if(seed > .55){
      float rb = abs(q.y + .22*sin(q.x*3.2 + seed*9.));
      vec3 c2 = rainbow(seed*1.7) * .6 + col*.6;
      body += c2 * 2.2 * smoothstep(.16*z+.02, 0., rb) * z;
    }
    // 小さな気泡
    vec2 bp = vec2(hash11(seed*5.), hash11(seed*9.))-.5;
    body += vec3(1.) * .9 * smoothstep(.07, .0, length(q0-bp*.9)) * z;
    vec3 R = reflect(vec3(0,0,-1), n);
    float sp = pow(max(dot(R, L), 0.), 70.);
    float win = smoothstep(.2, .0, length(q0 - vec2(-.38,.42)) - .12) ;
    float rim = smoothstep(.86, .955, d) * (1. - smoothstep(.955, 1., d));
    o = body * (1. - .35*pow(1.-z, 3.)) + vec3(1.)*(sp*4. + win*.35) + mix(col, vec3(1.), .7) * rim * 1.6;
    a = cov * .97;
  } else if(kind < 1.5){
    // 真珠
    float cov = 1.-smoothstep(1.-aa, 1.+aa, d);
    float z = sqrt(max(0., 1.-d*d));
    vec3 n = vec3(q0, z);
    float lam = max(dot(n, L), 0.);
    vec3 irid = rainbow(dot(n, vec3(.4,.3,.9))*1.3 + seed*3.);
    vec3 base = mix(col, irid, .22) * (.18 + .62*lam) * (.55 + .45*z);
    vec3 H = normalize(L + vec3(0,0,1));
    float sp = pow(max(dot(n,H),0.), 60.)*2.6 + pow(max(dot(n,H),0.), 8.)*.25;
    o = base + vec3(1., .97, .92)*sp + col*.12*pow(1.-z, 2.)*1.5;
    a = cov;
  } else if(kind < 2.5){
    // 金箔：ちぎれた縁、しわ、穴
    float ang = atan(q.y, q.x);
    float edge = .7 + .17*sin(ang*3. + seed*6.) + .16*(vnoise(vec2(ang*2.2, seed*10.))-.5) + .08*(vnoise(q*7.+seed*4.)-.5);
    float dd = length(q);
    float cov = 1.-smoothstep(edge-aa*1.5, edge+aa*1.5, dd);
    float hole = smoothstep(.70, .76, vnoise(q*4.5 + seed*17.));
    vec2 p = q*3.2 + seed*11.;
    float e = .02;
    float h0 = fbm(p), hx = fbm(p+vec2(e,0)), hy = fbm(p+vec2(0,e));
    vec3 n = normalize(vec3(-(hx-h0)/e*.55, -(hy-h0)/e*.55, 1.));
    n.xy = rot(vA)*n.xy;
    vec3 H = normalize(L + vec3(0,0,1));
    float sp = pow(max(dot(n,H),0.), 26.);
    vec3 gold = vec3(1., .66, .24);
    o = gold*(.06 + .32*h0) + gold*sp*5.5 + vec3(1.,.9,.7)*pow(sp, 4.)*3.;
    a = cov * (1.-hole);
  } else if(kind < 3.5){
    // 鉱物のかけら：面ごとに明るさが違い、回すと光る
    float facet, seam;
    int n = 5 + int(floor(hash11(seed*2.3)*3.));
    float sd = shard(q, seed, n, facet, seam);
    float cov = 1.-smoothstep(-aa, aa, sd);
    float fb = hash11(seed*31. + facet);
    float glint = pow(max(cos(vA*1.3 + uCellAngle + facet*1.9 + seed*20.), 0.), 18.);
    vec3 body = col * (.22 + 1.5*fb) + col * glint * 3.;
    body += mix(col, vec3(1.), .6) * smoothstep(.035, .0, seam) * (.4 + 1.8*glint);
    body += mix(col, vec3(1.), .5) * smoothstep(.06, .0, -sd) * 1.3;
    body *= .85 + .3*vnoise(q*9. + seed*3.);
    o = body; a = cov * .93;
  } else if(kind < 4.5){
    // ドライフラワー：透ける花びら、筋、乾いた縁
    float k = 5. + floor(hash11(seed*4.1)*2.);
    float ang = atan(q.y, q.x);
    float rp = .32 + .66*pow(abs(cos(ang*k*.5)), .55);
    float dd = length(q);
    float cov = 1.-smoothstep(rp-aa*1.5, rp+aa*1.5, dd);
    float t = dd/rp;
    vec3 pet = col*(.35 + .9*(1.-t*t)) * (.8 + .25*vnoise(q*6.+seed));
    float vein = smoothstep(.75, 1., abs(sin(ang*k*3.5 + vnoise(q*3.)*1.5)));
    pet *= 1. - .35*vein*(1.-t);
    pet = mix(pet, pet*vec3(.55,.4,.28), smoothstep(.7, 1., t)*.7);
    float cen = smoothstep(.2, .15, dd);
    float dots = step(.55, hash21(floor(q*26.+seed)));
    pet = mix(pet, vec3(.9,.62,.18)*(.6+.9*dots), cen);
    o = pet; a = cov * .86;
  } else if(kind < 5.5){
    // ラメ：六角形。向きで一瞬だけ強く光る
    vec2 p = abs(q);
    float hx = max(dot(p, vec2(.866, .5)), p.y);
    float cov = 1.-smoothstep(.82-fwidth(hx), .82+fwidth(hx), hx);
    vec3 c = col.r > .99 && col.g > .99 ? rainbow(seed*2. + vA*.15) : col;
    float spk = pow(.5+.5*cos(vA*1.7 + seed*40. + uCellAngle*3.), 26.);
    float spk2 = pow(.5+.5*cos(vA*2.9 + seed*71.), 60.);
    o = c*(.12 + 4.5*spk + 3.*spk2) + vec3(1.)*(spk*spk*3.5 + spk2*3.);
    a = cov;
  } else {
    // 写真の破片：ガラス越しの写真
    float facet, seam;
    float sd = shard(q, seed, 3 + int(floor(hash11(seed*5.)*2.)), facet, seam);
    float cov = 1.-smoothstep(-aa, aa, sd);
    int idx = int(vMisc.y);
    vec4 rc = uPhotoRect[idx];
    vec2 uv = rc.xy + (q*.5+.5)*rc.zw;
    vec3 ph = texture2D(uPhoto, uv).rgb;
    o = ph*1.25 + vec3(1.)*smoothstep(.05, 0., -sd)*.9;
    a = cov * .95;
  }
  gl_FragColor = vec4(o*a, a);
}
`;

export const charmFrag = /* glsl */ `
precision highp float;
uniform sampler2D uTex;
varying vec2 vQ;
varying float vA;
${NOISE}
void main(){
  vec2 q = rot(-vA) * vQ;
  vec2 uv = vec2(q.x/0.8, q.y) * .5 + .5;
  if(uv.x<0.||uv.x>1.||uv.y<0.||uv.y>1.) discard;
  vec4 t = texture2D(uTex, uv);
  gl_FragColor = vec4(t.rgb * t.a * 0.95, t.a);
}
`;

export const quadVert = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }
`;

// 筒の奥の光（拡散板）
export const backFrag = /* glsl */ `
precision highp float;
uniform float uBack;
uniform float uTime;
varying vec2 vUv;
${NOISE}
void main(){
  vec2 p = vUv*2.-1.;
  float r = length(p);
  float m = 1.-smoothstep(.985, 1., r);
  vec3 c = vec3(1., .93, .82) * uBack * (.55 + .45*(1.-r*r)) * (.9 + .2*fbm(p*3.+uTime*.02));
  gl_FragColor = vec4(c*m, 1.);
}
`;

// 溶液：光のゆらぎ・色つき・油膜の干渉色・液面
export const liquidFrag = /* glsl */ `
precision highp float;
uniform sampler2D uBeads;
uniform float uTime;
uniform float uLevel;
uniform vec2 uG;        // 筒の座標での重力（単位）
uniform vec3 uTint;
uniform float uFilm;
uniform float uWobble;
uniform float uHasLiquid;
uniform float uNet;
uniform float uMurk;
uniform float uCloud;
varying vec2 vUv;
${NOISE}
void main(){
  vec2 p = vUv*2.-1.;
  float up = -dot(p, uG);
  float surf = -1. + 2.*uLevel;
  float wet = uHasLiquid * (uLevel > .999 ? 1. : smoothstep(surf+.004, surf-.004, up));
  float t = uTime;
  vec2 flow = vec2(fbm(p*2.2 + vec2(t*.05, -t*.04)), fbm(p*2.2 + vec2(-t*.045, t*.06) + 7.)) - .5;
  vec2 off = flow * .012 * uWobble * wet;
  vec3 c = texture2D(uBeads, vUv + off).rgb;
  vec3 c2 = texture2D(uBeads, vUv + off*1.6).rgb;
  c = mix(c, max(c, c2), .35*wet);
  // 奥のカットガラス：ビーズの光が、ガラスの稜線を伝って広がる
  if(uNet > .001){
    vec2 q = p * 7.5 + vec2(1.7, 3.1);
    vec2 n = floor(q), f = fract(q);
    vec2 mg, mr; float md = 8.;
    for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
      vec2 g = vec2(float(i), float(j));
      vec2 o = vec2(hash21(n+g), hash21(n+g+17.3));
      vec2 r = g + o - f; float d = dot(r,r);
      if(d < md){ md = d; mr = r; mg = g; }
    }
    float ed = 8.;
    for(int j=-2;j<=2;j++) for(int i=-2;i<=2;i++){
      vec2 g = mg + vec2(float(i), float(j));
      vec2 o = vec2(hash21(n+g), hash21(n+g+17.3));
      vec2 r = g + o - f;
      if(dot(mr-r, mr-r) > .00001) ed = min(ed, dot(.5*(mr+r), normalize(r-mr)));
    }
    float facet = hash21(n + mg + 5.1);
    vec3 glow = vec3(0.);
    for(int k=0;k<10;k++){
      float a = float(k)*2.39996; float rr = .035 + .012*float(k);
      glow += texture2D(uBeads, vUv + vec2(cos(a), sin(a))*rr).rgb;
    }
    glow /= 10.;
    float line = 1. - smoothstep(.0, .035, ed);
    float lum0 = dot(c, vec3(.3,.59,.11));
    vec3 net = glow * (line * 2.6 + facet * facet * .35);
    c += net * uNet * (1. - smoothstep(.08, .5, lum0)) * (1.-smoothstep(.96, 1., length(p)));
  }
  c *= mix(vec3(1.), uTint, wet);
  // 油膜：厚みの場 → 干渉色
  float th = fbm(p*1.3 + flow*1.4 + vec2(t*.012, t*.009));
  vec3 irid = .5 + .5*cos(6.2831*(th*2.6 + vec3(0., .33, .67)));
  float lum = dot(c, vec3(.3,.59,.11));
  c = mix(c, c * (irid*1.5 + .1), uFilm * .32 * wet * smoothstep(.0, .6, lum));
  c += irid * uFilm * .02 * wet * smoothstep(.02, .4, lum);
  // 失敗：色を混ぜすぎると茶色く濁る
  float lumM = dot(c, vec3(.3,.59,.11));
  c = mix(c, vec3(lumM) * vec3(1.05, .78, .45) * .8 + vec3(.012,.008,.003), uMurk * .75 * wet);
  // 失敗：水と油は混ざらず、白い粒のもやになる
  float blob = smoothstep(.35, .75, fbm(p*3.5 + flow*2. + uTime*.03));
  c = mix(c, vec3(.32,.31,.29) * (.6 + .6*blob) + c*.25, uCloud * .7 * wet * (.5 + .5*blob));
  // 液面の線
  if(uHasLiquid > .5 && uLevel > .002 && uLevel < .999){
    float m = exp(-abs(up - surf)*90.);
    c += mix(vec3(1.,.95,.85), irid, .5) * m * .55;
  }
  float r = length(p);
  c *= 1.-smoothstep(.985, 1., r);
  gl_FragColor = vec4(c, 1.);
}
`;

// 筒をそのまま見る窓 / 万華鏡としてのぞく
export const viewFrag = /* glsl */ `
precision highp float;
uniform sampler2D uChamber;
uniform vec2 uRes;
uniform vec2 uCenter;
uniform float uR;
uniform float uMode;      // 0 = 窓, 1 = 万華鏡
uniform float uIris;      // 0..1.2
uniform float uMirrors;
uniform float uAngle;     // 筒の回転
uniform float uGAng;      // 画面での重力の向き
uniform float uTime;
uniform float uFade;
uniform float uSpan;
uniform float uRing;      // 窓の真鍮リングの見え方 0..1
uniform float uStretch;   // 扇の角度を何倍の範囲から拾うか
uniform float uGuide;     // 鏡の線を見せる 0..1
uniform float uSmudge;    // 指のあと 0..1
varying vec2 vUv;
${NOISE}

vec3 chamber(vec2 c){
  vec2 uv = c*.5+.5;
  return texture2D(uChamber, uv).rgb;
}

vec3 velvet(vec2 frag){
  vec2 p = (frag - uCenter)/max(uRes.x, uRes.y);
  float fib = vnoise(frag*vec2(.9, .35)) * .5 + vnoise(frag*.12)*.5;
  float sheen = .5 + .5*sin(p.x*3. - p.y*2. + .6);
  vec3 c = vec3(.016, .012, .016) * (.75 + .5*fib) * (.7 + .5*sheen);
  return c;
}

void main(){
  vec2 frag = vUv * uRes;
  vec2 p = (frag - uCenter) / uR;
  float r = length(p);
  vec3 col;
  float px = 1./uR;

  if(uMode < .5){
    // 窓：真鍮の枠に入った筒の口を、まっすぐ見る
    vec3 bg = velvet(frag);
    // 枠の影
    bg *= 1. - .6*uRing*exp(-max(r-1.1, 0.)*6.) * step(1., r);
    col = bg;
    if(r < 1.){
      vec2 c = rot(-uAngle) * p;
      vec3 ch = chamber(c);
      // ガラスの映り込み
      float sheen = smoothstep(.0, 1., 1.-length(p - vec2(-.55,.6))*.9) * .05;
      float inner = smoothstep(.86, 1., r);
      ch *= 1. - inner*.55;
      col = ch + vec3(1.,.95,.88)*sheen*uRing;
      // 鏡の数の説明：映る扇だけ明るく、ほかは暗く、境目に真鍮の線
      if(uGuide > .001){
        float al = 3.14159265 / uMirrors;
        float th = mod(atan(p.y, p.x) - (uGAng - al*.5), 6.2831853);
        float tr = mod(th, al);
        float dl = min(tr, al - tr) * r * uR;
        float line = exp(-dl*dl*.35) * smoothstep(.0, .08, r);
        float inW = step(th, al);
        col = mix(col, col*.3, uGuide*(1.-inW)*.8);
        col += vec3(.95,.75,.4) * line * uGuide * (inW > .5 || th > 6.2831853 - al*.02 ? 1.2 : .5);
      }
    }
    // 真鍮のリング
    float w = .075;
    if(r >= 1. && r < 1.+w && uRing > .001){
      float t = (r-1.)/w;
      float th = atan(p.y, p.x);
      vec3 brass = vec3(.62, .45, .2);
      float band = .45 + .55*pow(max(cos(th - 2.2), 0.), 3.) + .25*pow(max(cos(th + 1.), 0.), 6.);
      float bevel = 1. - pow(abs(t*2.-1.), 2.);
      float brush = .9 + .1*vnoise(vec2(th*300., t*3.));
      vec3 rc = brass * (.12 + .9*band*bevel) * brush;
      float ticks = step(.96, cos(th*36.)) * smoothstep(.75, .55, t) * step(.2, t);
      rc += brass * ticks * .5;
      rc += vec3(1.,.85,.6) * exp(-pow((t-.25)*12., 2.)) * band * .35;
      float edge = smoothstep(0., px*1.5/w, t) * smoothstep(1., 1.-px*1.5/w, t);
      col = mix(col, rc, edge * uRing);
    }
  } else {
    // 万華鏡：鏡2枚の継ぎ目で折り返す
    float N = uMirrors;
    float al = 3.14159265 / N;
    float phi0 = uGAng - al*.5;
    float th = atan(p.y, p.x) - phi0;
    th = mod(th, 6.2831853);
    float j = floor(th / al);
    float tr = mod(th, 2.*al);
    if(tr > al) tr = 2.*al - tr;
    float refl = min(j, 2.*N - j);
    float fa = phi0 + al*.5 + (tr - al*.5) * uStretch;
    vec2 pf = r * vec2(cos(fa), sin(fa));
    vec2 apex = vec2(0.); // 鏡の要＝筒の中心。真ん中に置いた物は真ん中に映る
    vec2 c = rot(-uAngle) * (pf * uSpan + apex);
    float inside = step(length(c), 1.);
    col = chamber(c) * inside;
    // 鏡は1回ごとに少しずつ光を失い、ほんのり色づく
    col *= pow(vec3(.95, .955, .935), vec3(refl));
    // 継ぎ目
    float sd = min(tr, al - tr) * r * uR;
    float seam = exp(-sd*sd*.9) * smoothstep(.02, .25, r);
    col = col * (1. - .3*seam) + col * seam * .25;
    // 失敗：鏡に指のあと（渦の筋）。そこだけ白くくもってぼやける
    if(uSmudge > .001){
      vec2 fp = p - vec2(.28, -.22);
      float fr = length(fp * vec2(1., 1.25));
      float ridge = .5 + .5*sin(fr*95. + atan(fp.y, fp.x)*1.5 + vnoise(p*6.)*3.);
      float m = smoothstep(.42, .15, fr) * (.55 + .45*ridge);
      vec2 fp2 = p - vec2(-.35, .3);
      float fr2 = length(fp2 * vec2(1.2, 1.));
      m = max(m, smoothstep(.3, .1, fr2) * (.55 + .45*(.5 + .5*sin(fr2*110.))));
      float lm = dot(col, vec3(.3,.59,.11));
      col = mix(col, vec3(lm)*.55 + vec3(.06,.058,.055), m * uSmudge * .8);
    }
    // 光の輪（絞りが開く）
    float ir = uIris;
    float m = smoothstep(ir, ir - 2.5*px - .015, r);
    float ring = exp(-pow((r - ir)*uR/3.5, 2.)) * smoothstep(1.15, .6, ir) * smoothstep(0., .1, ir);
    col = col * m + vec3(1., .86, .62) * ring * .9;
    // 筒の内側の暗さ
    col *= 1. - smoothstep(.82, 1.02, r) * .65;
    col += velvet(frag) * .4 * (1.-m);
  }
  gl_FragColor = vec4(col * uFade, 1.);
}
`;

// 縁だけの色ずれと残像
export const edgeFrag = /* glsl */ `
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uHist;
uniform vec2 uRes;
uniform vec2 uCenter;
uniform float uR;
uniform float uEdge;
uniform float uTrail;
varying vec2 vUv;
void main(){
  vec2 frag = vUv*uRes;
  vec2 d = frag - uCenter;
  float r = length(d)/uR;
  float e = smoothstep(.5, 1., r) * uEdge;
  vec2 dir = d / max(length(d), 1.);
  vec2 off = dir * e * e * 3.5 / uRes;
  vec3 c;
  c.r = texture2D(uScene, vUv + off).r;
  c.g = texture2D(uScene, vUv).g;
  c.b = texture2D(uScene, vUv - off).b;
  vec3 h = texture2D(uHist, vUv).rgb;
  c = mix(c, max(c, h*.93), clamp(e*uTrail, 0., .92));
  gl_FragColor = vec4(c, 1.);
}
`;

export const brightFrag = /* glsl */ `
precision highp float;
uniform sampler2D uTex;
uniform vec2 uTexel;
varying vec2 vUv;
void main(){
  vec3 c = vec3(0.);
  c += texture2D(uTex, vUv + uTexel*vec2(-1.,-1.)).rgb;
  c += texture2D(uTex, vUv + uTexel*vec2( 1.,-1.)).rgb;
  c += texture2D(uTex, vUv + uTexel*vec2(-1., 1.)).rgb;
  c += texture2D(uTex, vUv + uTexel*vec2( 1., 1.)).rgb;
  c *= .25;
  float l = max(c.r, max(c.g, c.b));
  float k = smoothstep(.8, 2.2, l);
  gl_FragColor = vec4(c * k, 1.);
}
`;

export const blurFrag = /* glsl */ `
precision highp float;
uniform sampler2D uTex;
uniform vec2 uDir;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(uTex, vUv).rgb * .227027;
  c += texture2D(uTex, vUv + uDir*1.3846).rgb * .3162162;
  c += texture2D(uTex, vUv - uDir*1.3846).rgb * .3162162;
  c += texture2D(uTex, vUv + uDir*3.2308).rgb * .0702703;
  c += texture2D(uTex, vUv - uDir*3.2308).rgb * .0702703;
  gl_FragColor = vec4(c, 1.);
}
`;

export const finalFrag = /* glsl */ `
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloomA;
uniform sampler2D uBloomB;
uniform float uBloom;
uniform float uTime;
uniform float uExposure;
varying vec2 vUv;
${NOISE}
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14), 0., 1.); }
void main(){
  vec3 c = texture2D(uScene, vUv).rgb;
  vec3 b = texture2D(uBloomA, vUv).rgb * .7 + texture2D(uBloomB, vUv).rgb * 1.1;
  c += b * uBloom;
  c = aces(c * uExposure);
  c = pow(c, vec3(1./2.2));
  c += (hash21(vUv*1000. + fract(uTime)*50.) - .5) * .012;
  gl_FragColor = vec4(c, 1.);
}
`;

// タイル（棚の見本）用：線形→sRGB だけ
export const tileFrag = /* glsl */ `
precision highp float;
uniform sampler2D uTex;
varying vec2 vUv;
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14), 0., 1.); }
void main(){
  vec4 t = texture2D(uTex, vUv);
  vec3 c = t.a > 0. ? t.rgb / t.a : vec3(0.);
  c = pow(aces(c*1.1), vec3(1./2.2));
  gl_FragColor = vec4(c, t.a);
}
`;
