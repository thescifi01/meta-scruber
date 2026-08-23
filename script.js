(function(){
  "use strict";

  /* ============================= UI plumbing ============================= */
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const browseBtn = document.getElementById('browseBtn');
  const scanPanel = document.getElementById('scanPanel');
  const scanThumb = document.getElementById('scanThumb');
  const fileNameEl = document.getElementById('fileName');
  const fileMetaEl = document.getElementById('fileMeta');
  const scanStatus = document.getElementById('scanStatus');
  const provenanceRow = document.getElementById('provenanceRow');
  const provenanceCaveat = document.getElementById('provenanceCaveat');
  const manifestEl = document.getElementById('manifest');
  const resultBlock = document.getElementById('resultBlock');
  const stampEl = document.getElementById('stamp');
  const resultCopy = document.getElementById('resultCopy');
  const downloadBtn = document.getElementById('downloadBtn');
  const resetBtn = document.getElementById('resetBtn');
  const errorBlock = document.getElementById('errorBlock');
  const aboutBtn = document.getElementById('aboutBtn');
  const aboutBox = document.getElementById('aboutBox');

  aboutBtn.addEventListener('click', () => aboutBox.classList.toggle('hidden'));
  browseBtn.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('click', () => fileInput.click());

  ['dragenter','dragover'].forEach(evt=>{
    dropzone.addEventListener(evt, e=>{ e.preventDefault(); dropzone.classList.add('drag'); });
  });
  ['dragleave','drop'].forEach(evt=>{
    dropzone.addEventListener(evt, e=>{ e.preventDefault(); dropzone.classList.remove('drag'); });
  });
  dropzone.addEventListener('drop', e=>{
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if(f) handleFile(f);
  });
  fileInput.addEventListener('change', e=>{
    const f = e.target.files && e.target.files[0];
    if(f) handleFile(f);
  });
  resetBtn.addEventListener('click', resetUI);

  function fmtBytes(n){
    if(n<1024) return n+' B';
    if(n<1024*1024) return (n/1024).toFixed(1)+' KB';
    return (n/(1024*1024)).toFixed(1)+' MB';
  }

  function resetUI(){
    scanPanel.classList.add('hidden');
    manifestEl.innerHTML='';
    resultBlock.classList.add('hidden');
    errorBlock.classList.add('hidden');
    provenanceRow.classList.add('hidden');
    provenanceRow.innerHTML='';
    provenanceCaveat.classList.add('hidden');
    scanStatus.textContent='Scanning…';
    scanStatus.classList.remove('done');
    scanThumb.innerHTML='<span class="glyph">FILE</span>';
    fileInput.value='';
  }

  async function handleFile(file){
    resetUI();
    scanPanel.classList.remove('hidden');
    fileNameEl.textContent = file.name || 'untitled';
    fileMetaEl.textContent = (file.type || 'unknown type') + ' · ' + fmtBytes(file.size);
    scanPanel.scrollIntoView({behavior:'smooth', block:'nearest'});

    const scanLine = document.createElement('div');
    scanLine.className = 'scanline';

    try{
      if(file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name||'')){
        await showImageThumb(file, scanLine);
        const buf = await file.arrayBuffer();
        let found = [], textBlobs = [];
        try{
          if(/jpe?g$/i.test(file.type) || /\.jpe?g$/i.test(file.name||'')){
            const r = scanJpeg(buf); found = r.found; textBlobs = r.textBlobs;
          } else if(/png$/i.test(file.type) || /\.png$/i.test(file.name||'')){
            const r = scanPng(buf); found = r.found; textBlobs = r.textBlobs;
          }
        }catch(e){ found = []; textBlobs = []; }
        renderProvenance(computeProvenance(textBlobs, found));
        await revealManifest(found, 'No identifying tags detected in a quick scan — re-encoding anyway to strip any hidden structural data.');
        const blob = await scrubImage(file);
        finish(found, blob, suggestName(file.name,'scrubbed'), 'image');
      } else if(file.type.startsWith('video/') || /\.(mp4|mov|m4v)$/i.test(file.name||'')){
        showVideoThumb(file, scanLine);
        const buf = await file.arrayBuffer();
        const parsed = parseMp4Container(buf);
        if(!parsed.valid){
          showError('This container isn\'t supported for safe rewriting yet.', 'Full lossless support currently covers <b>MP4, MOV and M4V</b> (the standard ISO-BMFF / QuickTime box structure). This file doesn\'t match that structure — it may be WebM, AVI, MKV, or a corrupted/unusual MP4 — so nothing was rewritten and no download is offered, to avoid handing back a broken file.');
          return;
        }
        const found = parsed.found;
        renderProvenance(computeProvenance(parsed.textBlobs, found));
        await revealManifest(found, 'No embedded metadata boxes detected — rebuilding the container anyway to clear timestamps.');
        const blob = rebuildMp4(buf, parsed);
        finish(found, blob, suggestName(file.name,'scrubbed'), 'video');
      } else {
        showError('Unsupported file type.', 'This tool currently handles image files (JPG, PNG, WEBP, GIF) and video files (MP4, MOV, M4V).');
      }
    }catch(err){
      console.error(err);
      showError('Something went wrong while scrubbing this file.', 'The file was left untouched and nothing was rewritten, so there\'s no risk of a corrupted download. Error detail: <code>'+ (err && err.message ? err.message.replace(/</g,'&lt;') : 'unknown') +'</code>');
    }
  }

  function suggestName(name, tag){
    name = name || 'file';
    const dot = name.lastIndexOf('.');
    if(dot<=0) return name+'-'+tag;
    return name.slice(0,dot)+'-'+tag+name.slice(dot);
  }

  function showError(title, detail){
    scanStatus.textContent='Stopped';
    errorBlock.innerHTML = '<b>'+title+'</b><br>'+detail;
    errorBlock.classList.remove('hidden');
  }

  async function showImageThumb(file, scanLine){
    return new Promise(resolve=>{
      const url = URL.createObjectURL(file);
      const img = document.createElement('img');
      img.onload = ()=>{ resolve(); };
      img.onerror = ()=> resolve();
      img.src = url;
      scanThumb.innerHTML='';
      scanThumb.appendChild(img);
      scanThumb.appendChild(scanLine);
    });
  }

  function showVideoThumb(file, scanLine){
    scanThumb.innerHTML='';
    try{
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.src = url; video.muted = true; video.playsInline = true;
      video.addEventListener('loadeddata', ()=>{ try{ video.currentTime = Math.min(0.3, (video.duration||1)/4); }catch(e){} });
      video.addEventListener('seeked', ()=>{
        try{
          const c = document.createElement('canvas');
          c.width=52; c.height=52;
          const ctx = c.getContext('2d');
          const scale = Math.max(52/video.videoWidth, 52/video.videoHeight);
          const w = video.videoWidth*scale, h = video.videoHeight*scale;
          ctx.drawImage(video, (52-w)/2, (52-h)/2, w, h);
          scanThumb.innerHTML='';
          scanThumb.appendChild(c);
          scanThumb.appendChild(scanLine);
        }catch(e){}
      });
    }catch(e){
      scanThumb.innerHTML='<span class="glyph">VIDEO</span>';
      scanThumb.appendChild(scanLine);
    }
  }

  async function revealManifest(items, emptyMsg){
    manifestEl.innerHTML='';
    if(!items || items.length===0){
      const div = document.createElement('div');
      div.className='m-empty';
      div.textContent = emptyMsg;
      manifestEl.appendChild(div);
      await sleep(500);
      return;
    }
    for(let i=0;i<items.length;i++){
      const it = items[i];
      const row = document.createElement('div');
      row.className='m-row';
      row.style.animationDelay = (i*0.09)+'s';
      row.innerHTML =
        '<span class="m-idx">0x0'+(i+1)+'</span>'+
        '<span class="m-label">'+escapeHtml(it.label)+'</span>'+
        '<span class="m-value"><span class="valtext">'+escapeHtml(it.value)+'</span><span class="redact-bar" style="animation-delay:'+(0.5+i*0.09)+'s"></span></span>'+
        '<span class="m-tag">found</span>';
      manifestEl.appendChild(row);
      await sleep(90);
    }
    await sleep(700 + items.length*90);
    manifestEl.querySelectorAll('.m-tag').forEach(t=>{ t.textContent='removed'; t.classList.add('gone'); setTimeout(()=>{t.style.color='var(--clear)';t.style.borderColor='var(--clear)';t.classList.remove('gone');t.style.opacity='1';},50); });
    await sleep(250);
  }

  function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  function finish(found, blob, name, kind){
    scanStatus.textContent='Done';
    scanStatus.classList.add('done');
    const url = URL.createObjectURL(blob);
    downloadBtn.href = url;
    downloadBtn.download = name;
    const n = found.length;
    stampEl.textContent = 'Cleared';
    const mechanism = kind==='video' ? 'Audio and video streams were copied untouched — only the container wrapper was rewritten.' : 'The image was re-encoded from raw pixels.';
    resultCopy.textContent = n>0
      ? n+' item'+(n===1?'':'s')+' of embedded metadata removed, including any provenance or generator tags. '+mechanism
      : (kind==='video' ? 'No metadata tags were found, but the container was rebuilt and its timestamps cleared regardless.' : 'No metadata tags were found, but the image was re-encoded regardless to be safe.');
    resultBlock.classList.remove('hidden');
    resultBlock.scrollIntoView({behavior:'smooth', block:'nearest'});
  }

  /* ============================= PROVENANCE: AI-generation detection ============================= */
  const AI_TOOL_SIGNATURES = [
    'midjourney','dall-e','dall\u00b7e','openai','stable diffusion','stabilityai','stability.ai',
    'adobe firefly','firefly generative','novelai','leonardo.ai','bing image creator',
    'playground ai','ideogram','imagen','runwayml','runway gen','pika labs','pika.art',
    'luma ai','luma dream machine','kling ai','sora','comfyui','automatic1111',
    'invokeai','fooocus','flux.1','black forest labs','recraft','krea ai',
    'magic media','generative fill','vertex ai','meta ai','emu video','veo','hunyuanvideo',
    'grok imagine','gemini image','nano banana'
  ];
  const C2PA_SIGNATURES = ['c2pa','contentcredentials.org','urn:c2pa','jumbf'];
  const DIGITAL_SOURCE_TYPES = [
    {match:'compositewithtrainedalgorithmicmedia', verdict:'ai', text:'IPTC Digital Source Type: composite / AI-edited media'},
    {match:'trainedalgorithmicmedia', verdict:'ai', text:'IPTC Digital Source Type: trained algorithmic media (AI-generated)'},
    {match:'algorithmicmedia', verdict:'ai', text:'IPTC Digital Source Type: algorithmic media'},
    {match:'digitalcapture', verdict:'camera', text:'IPTC Digital Source Type: digital camera capture'},
    {match:'negativefilm', verdict:'camera', text:'IPTC Digital Source Type: film capture'},
    {match:'positivefilm', verdict:'camera', text:'IPTC Digital Source Type: film capture'}
  ];

  const GENERATOR_KEY_SIGNAL = /^Generation (parameters|prompt|workflow)/i;
  function computeProvenance(textBlobs, found){
    const text = (textBlobs||[]).join(' \n ').toLowerCase();
    const signals = [];

    // Strong structural signals: keyword-named metadata fields that only generator tools write
    // (e.g. a PNG "parameters" chunk is the Automatic1111/Stable-Diffusion-WebUI signature,
    // regardless of whether the tool's name literally appears in the decoded text).
    for(const f of (found||[])){
      if(GENERATOR_KEY_SIGNAL.test(f.label)){
        signals.push({verdict:'ai', text:f.label+' field found (a marker specific to AI image generators)', strength:3});
      }
    }

    if(text.includes('digitalsourcetype')){
      for(const dst of DIGITAL_SOURCE_TYPES){
        if(text.includes(dst.match)) signals.push({verdict:dst.verdict, text:dst.text, strength:3});
      }
    }
    for(const tool of AI_TOOL_SIGNATURES){
      if(text.includes(tool)) signals.push({verdict:'ai', text:'Generator referenced in metadata: "'+tool+'"', strength:2});
    }
    if(signals.length===0){
      for(const sig of C2PA_SIGNATURES){
        if(text.includes(sig)){ signals.push({verdict:'unclear', text:'Content Credentials (C2PA) block present — origin declared but not decodable here', strength:1}); break; }
      }
    }
    const hasCameraTags = (found||[]).some(f => f.label==='Camera make' || f.label==='Camera model' || f.label==='Lens model');

    // dedupe by text
    const seen = new Set();
    const uniqueSignals = signals.filter(s => seen.has(s.text) ? false : (seen.add(s.text), true));
    uniqueSignals.sort((a,b)=>b.strength-a.strength);

    if(uniqueSignals.some(s=>s.verdict==='ai')){
      const top = uniqueSignals.find(s=>s.verdict==='ai');
      return {badge:'ai', headline:'AI-generated (declared in metadata)', detail: top.text, signals:uniqueSignals};
    }
    if(uniqueSignals.some(s=>s.verdict==='camera')){
      const top = uniqueSignals.find(s=>s.verdict==='camera');
      return {badge:'camera', headline:'Camera capture (declared in metadata)', detail: top.text, signals:uniqueSignals};
    }
    if(uniqueSignals.some(s=>s.verdict==='unclear')){
      const top = uniqueSignals.find(s=>s.verdict==='unclear');
      return {badge:'unclear', headline:'Content credentials present', detail: top.text, signals:uniqueSignals};
    }
    if(hasCameraTags){
      return {badge:'camera', headline:'Likely camera capture', detail:'EXIF shows camera/lens data and no AI-generator signatures — a reasonably strong (not certain) signal of a real photo.', signals:[]};
    }
    return {badge:'unknown', headline:'No provenance markers found', detail:'No AI-generator tags, C2PA credentials, or camera EXIF were embedded — this file\'s origin can\'t be determined from metadata alone.', signals:[]};
  }

  function renderProvenance(result){
    provenanceRow.classList.remove('hidden');
    provenanceCaveat.classList.remove('hidden');
    const badgeText = {ai:'AI generated', camera:'Camera capture', unclear:'Credentials present', unknown:'Undetermined'}[result.badge];
    provenanceRow.innerHTML =
      '<span class="prov-badge '+result.badge+'">'+badgeText+'</span>'+
      '<span class="prov-text"><span class="prov-headline">'+escapeHtml(result.headline)+'</span>'+
      '<span class="prov-detail">'+escapeHtml(result.detail)+'</span></span>';
  }

  /* ============================= IMAGE: scrub ============================= */
  async function scrubImage(file){
    const url = URL.createObjectURL(file);
    try{
      const img = await new Promise((res,rej)=>{
        const im = new Image();
        im.onload = ()=>res(im);
        im.onerror = rej;
        im.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img,0,0);
      let mime = file.type;
      let quality = undefined;
      if(mime==='image/jpeg' || mime==='image/jpg'){ quality = 0.92; }
      else if(mime==='image/webp'){ quality = 0.92; }
      else if(mime!=='image/png'){ mime = 'image/png'; } // gif/bmp/etc -> flatten to png
      const blob = await new Promise(res=> canvas.toBlob(res, mime, quality));
      return blob;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /* ============================= IMAGE: JPEG EXIF scan ============================= */
  function scanJpeg(buffer){
    const view = new DataView(buffer);
    const found = [];
    const textBlobs = [];
    if(view.getUint16(0) !== 0xFFD8) return {found, textBlobs};
    let offset = 2;
    let gpsSeen = false, xmpSeen = false, iptcSeen = false, c2paSeen = false;
    let tiff = null;

    while(offset < view.byteLength - 1){
      const marker = view.getUint16(offset);
      if((marker & 0xFF00) !== 0xFF00) break;
      if(marker === 0xFFD9) break;
      if(marker === 0xFFDA) break; // start of scan — done with markers
      if(offset+4 > view.byteLength) break;
      const length = view.getUint16(offset+2);
      const segStart = offset+4, segEnd = offset+2+length;
      if(marker === 0xFFE1){
        const sig = readAscii(view, offset+4, 6);
        if(sig === 'Exif\u0000\u0000'){
          tiff = offset+4+6;
          textBlobs.push(readAscii(view, segStart, segEnd-segStart));
        } else {
          const xmpSig = readAscii(view, offset+4, 29);
          if(xmpSig.indexOf('http://ns.adobe.com/xap/') === 0){
            xmpSeen = true;
            textBlobs.push(readAscii(view, segStart, segEnd-segStart));
          }
        }
      } else if(marker === 0xFFED){
        iptcSeen = true;
        textBlobs.push(readAscii(view, segStart, segEnd-segStart));
      } else if(marker === 0xFFEB){
        c2paSeen = true;
        textBlobs.push(readAscii(view, segStart, segEnd-segStart));
      }
      offset += 2 + length;
    }

    if(tiff !== null){
      try{
        const little = view.getUint16(tiff) === 0x4949;
        const rd16 = (o)=> little ? view.getUint16(o,true) : view.getUint16(o,false);
        const rd32 = (o)=> little ? view.getUint32(o,true) : view.getUint32(o,false);
        const ifd0Off = rd32(tiff+4);
        const ifd0 = readIFD(view, tiff, tiff+ifd0Off, little);

        const tagMap = {
          0x010F:{label:'Camera make'}, 0x0110:{label:'Camera model'},
          0x0131:{label:'Software'}, 0x0132:{label:'Date/time'},
          0x8298:{label:'Copyright'}, 0x013B:{label:'Author'}
        };
        for(const tagStr in tagMap){
          const tag = parseInt(tagStr,10);
          if(ifd0.entries[tag] !== undefined){
            found.push({label:tagMap[tag].label, value: String(ifd0.entries[tag]).trim()});
          }
        }
        if(ifd0.entries[0x8825] !== undefined){ gpsSeen = true; }

        if(ifd0.entries[0x8769] !== undefined){
          try{
            const exifIfd = readIFD(view, tiff, tiff+ifd0.entries[0x8769], little);
            if(exifIfd.entries[0x9003]) found.push({label:'Date taken', value:String(exifIfd.entries[0x9003]).trim()});
            if(exifIfd.entries[0xA434]) found.push({label:'Lens model', value:String(exifIfd.entries[0xA434]).trim()});
          }catch(e){}
        }

        if(gpsSeen){
          try{
            const gpsIfd = readIFD(view, tiff, tiff+ifd0.entries[0x8825], little, true);
            const coords = decodeGPS(gpsIfd.raw, view, tiff, little);
            found.push({label:'GPS location', value: coords || 'present'});
          }catch(e){
            found.push({label:'GPS location', value:'present'});
          }
        }
      }catch(e){ /* malformed EXIF — ignore, canvas re-encode strips it regardless */ }
    }
    if(xmpSeen) found.push({label:'XMP metadata', value:'embedded XML block'});
    if(iptcSeen) found.push({label:'IPTC metadata', value:'embedded caption/keyword data'});
    if(c2paSeen) found.push({label:'Content Credentials', value:'C2PA block (APP11)'});
    return {found, textBlobs};
  }

  function readAscii(view, offset, len){
    let s='';
    for(let i=0;i<len && offset+i<view.byteLength;i++) s+=String.fromCharCode(view.getUint8(offset+i));
    return s;
  }

  const TYPE_SIZES = {1:1,2:1,3:2,4:4,5:8,6:1,7:1,8:2,9:4,10:8,11:4,12:8};
  function readIFD(view, tiffStart, ifdOffset, little, wantRaw){
    const rd16 = (o)=> little ? view.getUint16(o,true) : view.getUint16(o,false);
    const rd32 = (o)=> little ? view.getUint32(o,true) : view.getUint32(o,false);
    const count = rd16(ifdOffset);
    const entries = {};
    const raw = {};
    for(let i=0;i<count;i++){
      const eOff = ifdOffset+2+i*12;
      const tag = rd16(eOff);
      const type = rd16(eOff+2);
      const num = rd32(eOff+4);
      const unitSize = TYPE_SIZES[type] || 1;
      const totalSize = unitSize*num;
      const valueOff = totalSize<=4 ? eOff+8 : tiffStart+rd32(eOff+8);
      if(type===2){ // ASCII
        let s='';
        for(let k=0;k<num-1;k++) s+=String.fromCharCode(view.getUint8(valueOff+k));
        entries[tag]=s;
      } else if(type===3){ entries[tag]= rd16(valueOff); }
      else if(type===4){ entries[tag]= rd32(valueOff); }
      if(wantRaw) raw[tag] = {valueOff, type, num};
    }
    return {entries, raw};
  }

  function decodeGPS(raw, view, tiffStart, little){
    const rd32 = (o)=> little ? view.getUint32(o,true) : view.getUint32(o,false);
    function rational(o){ return rd32(o)/rd32(o+4); }
    function dms(off){
      return rational(off) + rational(off+8)/60 + rational(off+16)/3600;
    }
    if(!raw[1] || !raw[2] || !raw[3] || !raw[4]) return null;
    const latRefOff = raw[1].valueOff;
    const latRef = String.fromCharCode(view.getUint8(latRefOff));
    const lonRefOff = raw[3].valueOff;
    const lonRef = String.fromCharCode(view.getUint8(lonRefOff));
    let lat = dms(raw[2].valueOff);
    let lon = dms(raw[4].valueOff);
    if(latRef==='S') lat = -lat;
    if(lonRef==='W') lon = -lon;
    return lat.toFixed(5)+'°, '+lon.toFixed(5)+'°';
  }

  /* ============================= IMAGE: PNG chunk scan ============================= */
  const PNG_GENERATOR_KEYS = {parameters:'Generation parameters (Stable Diffusion)', prompt:'Generation prompt', workflow:'Generation workflow (ComfyUI)'};
  function scanPng(buffer){
    const view = new DataView(buffer);
    const found = [];
    const textBlobs = [];
    const sig = [0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A];
    for(let i=0;i<8;i++) if(view.getUint8(i)!==sig[i]) return {found, textBlobs};
    let offset = 8;
    while(offset+8 <= view.byteLength){
      const len = view.getUint32(offset);
      const type = readAscii(view, offset+4, 4);
      const dataStart = offset+8;
      if(type==='tEXt' || type==='zTXt' || type==='iTXt'){
        let key='', k=0;
        for(;k<len && k<79;k++){
          const b = view.getUint8(dataStart+k);
          if(b===0) break;
          key += String.fromCharCode(b);
        }
        const genLabel = PNG_GENERATOR_KEYS[key.toLowerCase()];
        if(genLabel){
          found.push({label:genLabel, value:'embedded'});
          textBlobs.push(key); // flag for signature scan even if we can't decode compressed text
        } else {
          found.push({label: key || type, value: type==='tEXt' ? 'text data' : (type==='zTXt' ? 'compressed text' : 'international text')});
        }
        if(type==='tEXt'){
          // uncompressed: keyword + \0 + text — safe to read directly for provenance scanning
          let val = readAscii(view, dataStart+k+1, len-k-1);
          textBlobs.push(key+': '+val);
        } else {
          textBlobs.push(key);
        }
      } else if(type==='eXIf'){
        found.push({label:'EXIF block', value:'embedded camera data'});
        textBlobs.push(readAscii(view, dataStart, len));
      } else if(type==='caBX'){
        found.push({label:'Content Credentials', value:'C2PA block (caBX chunk)'});
        textBlobs.push('c2pa caBX');
      } else if(type==='tIME'){
        const y = view.getUint16(dataStart);
        const mo = view.getUint8(dataStart+2), d = view.getUint8(dataStart+3);
        found.push({label:'Last modified', value: y+'-'+String(mo).padStart(2,'0')+'-'+String(d).padStart(2,'0')});
      } else if(type==='IDAT' || type==='IEND'){
        break;
      }
      offset = dataStart + len + 4;
    }
    return {found, textBlobs};
  }

  /* ============================= VIDEO: MP4/MOV box parsing ============================= */
  const REMOVE_TYPES = new Set(['udta','meta','free','skip','pnot','uuid']);
  const CONTAINER_TYPES = new Set(['moov','trak','mdia','minf','stbl','edts','dinf','mvex']);
  const TIMESTAMP_BOXES = new Set(['mvhd','tkhd','mdhd']);

  function typeAt(view, offset){
    let s='';
    for(let i=0;i<4;i++) s+=String.fromCharCode(view.getUint8(offset+i));
    return s;
  }

  function readBoxHeader(view, offset, end){
    if(offset+8>end) return null;
    let size = view.getUint32(offset);
    const type = typeAt(view, offset+4);
    let headerSize = 8;
    if(size===1){
      if(offset+16>end) return null;
      const hi = view.getUint32(offset+8), lo = view.getUint32(offset+12);
      size = hi*4294967296+lo;
      headerSize = 16;
    } else if(size===0){
      size = end-offset;
    }
    if(size<headerSize || offset+size>end) return null;
    return {start:offset, type, size, headerSize, end:offset+size};
  }

  function parseMp4Container(buffer){
    const view = new DataView(buffer);
    const end = buffer.byteLength;
    // validate: first box should be ftyp (or a small handful of leading boxes then ftyp)
    let off = 0, sawFtyp=false, moovBox=null, mdatBox=null;
    const topBoxes = [];
    while(off < end){
      const h = readBoxHeader(view, off, end);
      if(!h) break;
      topBoxes.push(h);
      if(h.type==='ftyp') sawFtyp=true;
      if(h.type==='moov' && !moovBox) moovBox=h;
      if(h.type==='mdat' && !mdatBox) mdatBox=h;
      off = h.end;
    }
    if(!sawFtyp || !moovBox || !mdatBox){
      return {valid:false};
    }
    const ctx = {found: [], textBlobs: []};
    try{ scanForMetadata(view, moovBox.start+moovBox.headerSize, moovBox.end, ctx); }catch(e){}
    return {valid:true, mdatStart: mdatBox.start, found: ctx.found, textBlobs: ctx.textBlobs};
  }

  const XMP_UUID_HEX = 'be7acfcb97a942e89c71999491e3afac';
  function bytesToHex(view, start, len){
    let s='';
    for(let i=0;i<len;i++) s += view.getUint8(start+i).toString(16).padStart(2,'0');
    return s;
  }

  function scanForMetadata(view, start, end, ctx){
    let off = start;
    while(off<end){
      const h = readBoxHeader(view, off, end);
      if(!h) break;
      if(h.type==='udta'){
        try{ scanUdta(view, h.start+h.headerSize, h.end, ctx); }catch(e){}
      } else if(h.type==='meta'){
        try{ scanMeta(view, h, ctx); }catch(e){
          ctx.found.push({label:'Embedded metadata', value:'metadata container (meta atom)'});
        }
      } else if(h.type==='uuid'){
        try{
          const hex = bytesToHex(view, h.start+h.headerSize, 16);
          const payloadStart = h.start+h.headerSize+16;
          const payloadLen = h.end-payloadStart;
          if(hex===XMP_UUID_HEX){
            const text = readAscii(view, payloadStart, payloadLen);
            ctx.found.push({label:'XMP metadata', value:'embedded XML block'});
            ctx.textBlobs.push(text);
          } else {
            ctx.found.push({label:'Vendor metadata (uuid box)', value:'present, type not identified'});
          }
        }catch(e){}
      } else if(CONTAINER_TYPES.has(h.type)){
        scanForMetadata(view, h.start+h.headerSize, h.end, ctx);
      }
      off = h.end;
    }
  }

  const QT_KEY_LABELS = {
    '\u00A9mak':'Camera make', '\u00A9mod':'Camera model', '\u00A9day':'Date created',
    '\u00A9swr':'Software', '\u00A9too':'Encoder', '\u00A9xyz':'GPS location',
    '\u00A9cpy':'Copyright', '\u00A9nam':'Title', '\u00A9ART':'Artist', '\u00A9enc':'Encoded by'
  };

  function readQtString(view, dataStart, dataLen){
    // QuickTime "counted string": 2-byte length + 2-byte language + text
    if(dataLen>=4){
      const strLen = view.getUint16(dataStart);
      if(strLen>0 && strLen<=dataLen-4){
        return readAscii(view, dataStart+4, strLen).replace(/\u0000+$/,'');
      }
    }
    // fallback: raw text
    let s='';
    for(let i=0;i<dataLen;i++){
      const c = view.getUint8(dataStart+i);
      if(c>=32 && c<127) s+=String.fromCharCode(c);
    }
    return s.trim();
  }

  function scanUdta(view, start, end, ctx){
    let off=start;
    while(off<end){
      const h = readBoxHeader(view, off, end);
      if(!h) break;
      const label = QT_KEY_LABELS[h.type];
      if(label){
        const dataStart = h.start+h.headerSize;
        const dataLen = h.end-dataStart;
        let val = readQtString(view, dataStart, dataLen);
        if(h.type==='\u00A9xyz'){
          const m = val.match(/([+-]\d+\.\d+)([+-]\d+\.\d+)/);
          if(m) val = parseFloat(m[1]).toFixed(5)+'°, '+parseFloat(m[2]).toFixed(5)+'°';
        }
        if(val){ ctx.found.push({label, value: val}); ctx.textBlobs.push(label+': '+val); }
      } else if(h.type==='meta'){
        try{ scanMeta(view, h, ctx); }catch(e){}
      }
      off = h.end;
    }
  }

  function scanMeta(view, h, ctx){
    // ISO meta: fullbox header (4 bytes) then children. QuickTime meta: children immediately.
    // Try ISO-style first (skip 4 bytes), look for 'keys'/'ilst' or 'hdlr'/'ilst'.
    const tryOffsets = [h.start+h.headerSize+4, h.start+h.headerSize];
    for(const childStart of tryOffsets){
      let keysList = null, ilstBox = null;
      let off = childStart;
      let any=false;
      while(off < h.end){
        const c = readBoxHeader(view, off, h.end);
        if(!c) break;
        any = true;
        if(c.type==='keys') keysList = c;
        if(c.type==='ilst') ilstBox = c;
        off = c.end;
      }
      if(!any) continue;
      if(keysList && ilstBox){
        const keys = parseKeys(view, keysList);
        parseIlst(view, ilstBox, keys, ctx);
        return;
      } else if(ilstBox){
        // iTunes-style top-level atoms without explicit keys table — skip detail
        ctx.found.push({label:'Embedded metadata', value:'metadata container (meta atom)'});
        return;
      }
    }
    ctx.found.push({label:'Embedded metadata', value:'metadata container (meta atom)'});
  }

  function parseKeys(view, keysBox){
    const keys = [];
    const base = keysBox.start+keysBox.headerSize;
    const entryCount = view.getUint32(base+4);
    let off = base+8;
    for(let i=0;i<entryCount;i++){
      if(off+8>keysBox.end) break;
      const keySize = view.getUint32(off);
      const ns = typeAt(view, off+4);
      const nameLen = keySize-8;
      let name='';
      for(let k=0;k<nameLen;k++) name+=String.fromCharCode(view.getUint8(off+8+k));
      keys.push(name);
      off += keySize;
    }
    return keys;
  }

  function parseIlst(view, ilstBox, keys, ctx){
    let off = ilstBox.start+ilstBox.headerSize;
    while(off<ilstBox.end){
      const item = readBoxHeader(view, off, ilstBox.end);
      if(!item) break;
      const idx = view.getUint32(item.start); // the 4 "type" bytes are actually a 1-based index (big-endian uint32)
      let dataOff = item.start+item.headerSize;
      const dataBox = readBoxHeader(view, dataOff, item.end);
      if(dataBox && dataBox.type==='data'){
        const valStart = dataBox.start+dataBox.headerSize+8; // skip type-indicator(4) + locale(4)
        const valLen = dataBox.end-valStart;
        let val='';
        for(let k=0;k<valLen;k++){
          const c = view.getUint8(valStart+k);
          if(c>=32 && c<127) val+=String.fromCharCode(c);
        }
        val = val.trim();
        const keyName = keys[idx-1] || ('key #'+idx);
        const label = humanizeKey(keyName);
        if(val){ ctx.found.push({label, value:val}); ctx.textBlobs.push(keyName+': '+val); }
      }
      off = item.end;
    }
  }

  function humanizeKey(key){
    const short = key.split('.').pop();
    const map = {
      make:'Camera make', model:'Camera model', software:'Software',
      creationdate:'Date created', iso6709:'GPS location', location:'GPS location',
      make_apple:'Camera make', direction:'Compass direction', description:'Description'
    };
    const lower = (short||'').toLowerCase();
    if(map[lower]) return map[lower];
    return short ? short.charAt(0).toUpperCase()+short.slice(1) : key;
  }

  /* ============================= VIDEO: rebuild (strip) ============================= */
  function concatChunks(chunks){
    let total=0;
    for(const c of chunks) total+=c.byteLength;
    const out = new Uint8Array(total);
    let pos=0;
    for(const c of chunks){ out.set(c,pos); pos+=c.byteLength; }
    return out;
  }

  function makeHeader(size, type){
    const buf = new ArrayBuffer(8);
    const dv = new DataView(buf);
    dv.setUint32(0,size);
    for(let i=0;i<4;i++) dv.setUint8(4+i, type.charCodeAt(i));
    return new Uint8Array(buf);
  }

  function findRemovalDelta(view, start, end, mdatStart){
    let removed=0;
    let off=start;
    while(off<end){
      const h = readBoxHeader(view, off, end);
      if(!h) break;
      if(REMOVE_TYPES.has(h.type)){
        if(h.start < mdatStart) removed += h.size;
      } else if(CONTAINER_TYPES.has(h.type)){
        removed += findRemovalDelta(view, h.start+h.headerSize, h.end, mdatStart);
      }
      off = h.end;
    }
    return removed;
  }

  function patchTimestamps(raw){
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const hdr = dv.getUint32(0)===1 ? 16 : 8;
    if(hdr+4 >= raw.byteLength) return;
    const version = dv.getUint8(hdr);
    let p = hdr+4;
    if(version===1){
      if(p+16<=raw.byteLength){ dv.setUint32(p,0); dv.setUint32(p+4,0); dv.setUint32(p+8,0); dv.setUint32(p+12,0); }
    } else {
      if(p+8<=raw.byteLength){ dv.setUint32(p,0); dv.setUint32(p+4,0); }
    }
  }

  function patchStco(raw, delta){
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const hdr = dv.getUint32(0)===1 ? 16 : 8;
    const count = dv.getUint32(hdr+4);
    let pos = hdr+8;
    for(let i=0;i<count;i++){
      if(pos+4>raw.byteLength) break;
      const val = dv.getUint32(pos);
      dv.setUint32(pos, Math.max(0, val-delta));
      pos+=4;
    }
  }

  function patchCo64(raw, delta){
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const hdr = dv.getUint32(0)===1 ? 16 : 8;
    const count = dv.getUint32(hdr+4);
    let pos = hdr+8;
    for(let i=0;i<count;i++){
      if(pos+8>raw.byteLength) break;
      const hi = dv.getUint32(pos), lo = dv.getUint32(pos+4);
      const val = hi*4294967296+lo;
      const nv = Math.max(0, val-delta);
      const nhi = Math.floor(nv/4294967296);
      const nlo = nv >>> 0;
      dv.setUint32(pos, nhi); dv.setUint32(pos+4, nlo);
      pos+=8;
    }
  }

  function processBoxes(buffer, start, end, delta){
    const view = new DataView(buffer);
    const out = [];
    let off = start;
    while(off<end){
      const h = readBoxHeader(view, off, end);
      if(!h) throw new Error('malformed box structure');
      if(REMOVE_TYPES.has(h.type)){
        off = h.end; continue;
      }
      if(CONTAINER_TYPES.has(h.type)){
        const innerChunks = processBoxes(buffer, h.start+h.headerSize, h.end, delta);
        const payload = concatChunks(innerChunks);
        const newSize = 8+payload.byteLength;
        out.push(makeHeader(newSize, h.type));
        out.push(payload);
        off = h.end; continue;
      }
      const raw = new Uint8Array(buffer.slice(h.start, h.end));
      if(TIMESTAMP_BOXES.has(h.type)) patchTimestamps(raw);
      else if(h.type==='stco') patchStco(raw, delta);
      else if(h.type==='co64') patchCo64(raw, delta);
      out.push(raw);
      off = h.end;
    }
    return out;
  }

  function rebuildMp4(buffer, parsed){
    const view = new DataView(buffer);
    const delta = findRemovalDelta(view, 0, buffer.byteLength, parsed.mdatStart);
    const chunks = processBoxes(buffer, 0, buffer.byteLength, delta);
    const finalBytes = concatChunks(chunks);
    return new Blob([finalBytes], {type: 'video/mp4'});
  }

})();
