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
      const totalSize = unit