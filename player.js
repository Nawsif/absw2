/*
This file is part of "love.js" by 2dengine.
https://2dengine.com/doc/lovejs.html

MIT License

Copyright (c) 2022 2dengine LLC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

(function() {
  // DOM
  var script = document.currentScript;
  var canvas = document.getElementById('canvas');
  if (!canvas) {
    canvas = document.createElement('CANVAS');
    canvas.id = 'canvas';
    script.parentNode.insertBefore(canvas, script);
  }
  canvas.oncontextmenu = function () {
    event.preventDefault();
  }
  
  var spinner = document.getElementById('spinner');
  if (!spinner) {
    spinner = document.createElement('DIV');
    spinner.id = 'spinner';
    script.parentNode.after(spinner, script);
  }
  spinner.className = 'pending';

  // Actual player object
  var Player = {};
  window.Player = Player;
  
  Player.version = '11.5';
  Player.cache = true;
  Player.arg = [];
  Player.uri = 'nogame.love';
  
  // Opens the IndexedDB connection
  var indexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
  Player.openDB = function () {
    return new Promise(function (resolve, reject) {
      if (!indexedDB)
        reject('IndexedDB is not supported');
      // Open the local database used to cache packages
      var req = indexedDB.open('EM_PRELOAD_CACHE', 1);
      req.onupgradeneeded = function (event) {
        var db = event.target.result;
        if (db.objectStoreNames.contains('PACKAGES'))
          db.deleteObjectStore('PACKAGES');
        db.createObjectStore('PACKAGES');
      };
      req.onerror = function (error) {
        reject(error);
      };
      req.onsuccess = function (event) {
        // Check if the database is malformed
        var db = event.target.result;
        if (!db.objectStoreNames.contains('PACKAGES')) {
          db.close();
          var req2 = indexedDB.deleteDatabase('EM_PRELOAD_CACHE');
          req2.onerror = function (error) {
            reject(error);
          }
          req2.onsuccess = function (event) {
            resolve(db);
          }
        } else {
          resolve(db);
        }
      };
    });
  }

  // Deletes a stored IndexedDB package
  Player.deletePkg = function (uri) {
    // Delete the store package from cache
    return new Promise(function (resolve, reject) {
      Player.openDB()
        .then(function (db) {
          var trans = db.transaction(['PACKAGES'], 'readwrite');
          var req = trans.objectStore('PACKAGES').delete(uri);
          req.onerror = function (error) {
            reject(error);
          };
          req.onsuccess = function (event) {
            resolve();
          };
        })
        .catch(function (e) {
          reject(e);
        });
    });
  }
  
  // Deletes all stored IndexedDB packages
  Player.deletePkgs = function () {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.deleteDatabase('PACKAGES');
      req.onerror = function (e) {
        reject(e);
      };
      req.onsuccess = function (e) {
        resolve();
      };
    });
  }
  
  // Stores binary data into an IndexedDB package
  Player.storePkg = function(uri, data) {
    return new Promise(function (resolve, reject) {
      Player.openDB()
        .then(function (db) {
          var trans = db.transaction(['PACKAGES'], 'readwrite');
          var req = trans.objectStore('PACKAGES').put(data, uri);
          req.onerror = function (error) {
            reject(error);
          };
          req.onsuccess = function (event) {
            resolve();
          };
        })
        .catch(function (e) {
          reject(e);
        });
    });
  }
  
  // Reads the cached IndexedDB package
  Player.readPkg = function (uri) {
    return new Promise(function (resolve, reject) {
      Player.openDB()
        .then(function (db) {
          // Check if there's a cached package, and if so whether it's the latest available
          var trans = db.transaction(['PACKAGES'], 'readonly');
          var req = trans.objectStore('PACKAGES').get(uri);
          req.onerror = function (error) {
            reject(error);
          };
          req.onsuccess = function (event) {
            resolve(event.target.result);
          };
        })
        .catch(function (e) {
          reject(e);
        });
    });
  }

  // Fetches the package
  async function fetchPackage(uri) {
    if (uri !== 'game.love') {
      var response = await fetch(uri, {credentials: 'same-origin'});
      if (!response.ok) throw new Error('Could not load '+uri+': HTTP '+response.status);
      return response.arrayBuffer();
    }
    var response = await fetch('asset-manifest.json', {cache: 'no-store'});
    if (!response.ok) throw new Error('Asset manifest is missing');
    var manifest = await response.json();
    if (!Number.isSafeInteger(manifest.bytes) || manifest.bytes <= 0 || manifest.bytes > 1e9 || !Array.isArray(manifest.parts))
      throw new Error('Invalid asset manifest');
    var result = new Uint8Array(manifest.bytes);
    var offset = 0;
    for (var part of manifest.parts) {
      if (!/^game-\d{3}-[a-f0-9]{12}\.bin$/.test(part.file)) throw new Error('Invalid asset path');
      var response = await fetch(part.file);
      if (!response.ok) throw new Error('Could not load '+part.file);
      var bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== part.bytes || offset + bytes.length > result.length) throw new Error('Asset part has wrong size');
      if (globalThis.crypto && crypto.subtle) {
        var digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
        var hash = Array.from(digest, x => x.toString(16).padStart(2,'0')).join('');
        if (hash !== part.sha256) throw new Error('Asset integrity check failed: '+part.file);
      }
      result.set(bytes, offset); offset += bytes.length;
      var status = document.getElementById('status');
      if (status) status.textContent = 'Loading game assets… '+Math.round(offset/result.length*100)+'%';
    }
    if (offset !== result.length) throw new Error('Incomplete asset manifest');
    return result.buffer;
  }
  Player.requestPkg = function(uri) {
    return new Promise(function (resolve, reject) {
      var data;
      Player.readPkg(uri)
        .then (function (raw) {
          data = raw;
        })
        .catch (function(e) {
          console.warn(e);
        })
        .finally(function () {
          if (data && Player.cache && uri !== 'game.love') {
            resolve({ data: data, name: uri });
            return;
          }
          // Fetch the package remotely
          console.log('fetching:'+uri);
          fetchPackage(uri)
            .then(function (data) {
              data = new Uint8Array(data);
              if (uri.endsWith('.love') || uri.endsWith('.zip')) {
                // Check if the header is a valid ZIP archive
                var head = [80,75,3,4];
                for (var i = 0; i < head.length; i++)
                  if (data[i] != head[i])
                    return reject('The fetched resource is not a valid love package');
              }
              // Cache remote package for subsequent requests
              if (Player.cache && uri !== 'game.love') Player.storePkg(uri, data);
              resolve({ data: data, name: uri });
            }).catch(reject);
        });
    });
  }
  
  // Fetches all required packages
  Player.requestPkgs = function(uri) {
    return new Promise(function (resolve, reject) {
      var list = [ uri ];
      list.push('lua/normalize1.lua');
      list.push('lua/normalize2.lua');
      list.push('11.5/love.wasm');
      var loaded = 0;
      var cache = {};
      for (var i = 0; i < list.length; i++) {
        Player.requestPkg(list[i])
          .then(function (pkg) {
            cache[pkg.name] = pkg.data;
            loaded ++;
            if (list.length == loaded)
              resolve(cache);
          })
          .catch (function(e) {
            reject(e);
          });
      }
    });
  }
  
  // Appends and loads a script element
  Player.script = function(uri, func) {
    var s = document.createElement('script');
    s.type = 'text/javascript';
    s.src = uri;
    s.async = true;
    s.onload = func;
    document.body.appendChild(s);
  }

  // Runs the requested package
  Player.start = function (uri, arg) {    
    spinner.className = 'loading';
    uri = uri || Player.uri;
    arg = arg || Player.arg;
    Player.uri = uri;
    Player.arg = arg;

    // prepare arguments
    var vargs = arg.slice();
    var pkg = uri.substring(uri.lastIndexOf('/') + 1);
    //pkg = pkg.split('.').shift();
    vargs.unshift(pkg);

    Player.requestPkgs(uri)
      .then(function (cache) {
        var Module = window.Module || {};
        window.Module = Module;
        
        if (Module.exit)
          Module.exit(0);

        // allocate memory based on the system and package size
        var memory = (navigator.deviceMemory || 1)*1e+9;
        Module.INITIAL_MEMORY = Math.min(4*cache[uri].length + 2e+7, memory);
        Module.canvas = canvas;
        Module.warn = window.onerror;
		window.portState = {phase: 'starting', error: null};
		var status = document.getElementById('status');
		if (status) status.textContent = 'Starting game…';
		var saveTimer, saveSyncing = false, saveDirty = false;
        function flushGameSaves() {
          if (saveSyncing) { saveDirty = true; return; }
          saveSyncing = true;
          Module.FS.syncfs(false, function(error) {
            saveSyncing = false;
            if (error) console.error('Local save failed', error);
            if (saveDirty) { saveDirty = false; flushGameSaves(); }
          });
        }
        window.addEventListener('pagehide', flushGameSaves);
        Module.print = function(message) {
          if (String(message).includes('was saved to')) {
            clearTimeout(saveTimer);
            saveTimer = setTimeout(flushGameSaves, 150);
          }
		  console.log(message);
          if (String(message).startsWith('WEB_AUDIT ')) {
            try {
              var row = JSON.parse(String(message).slice(10));
              if (row.event === 'started') {
                window.portAuditState = {mode: row.mode, total: row.total, finished: false};
              }
              var rows = row.event === 'started' ? {} : JSON.parse(localStorage.getItem('absw2-audit') || '{}');
              if (row.status && row.index) rows[row.index] = row;
              localStorage.setItem('absw2-audit', JSON.stringify(rows));
              window.portAudit = rows;
              if (window.portAuditState) {
                window.portAuditState.current = row;
                window.portAuditState.checked = Object.keys(rows).length;
                window.portAuditState.errors = Object.values(rows).filter(function (item) { return item.status === 'error'; }).length;
                if (row.event === 'finished') window.portAuditState.finished = true;
                localStorage.setItem('absw2-audit-' + window.portAuditState.mode,
                  JSON.stringify({state: window.portAuditState, results: rows}));
                // The explicit local audit server can retain in-game reference images.
                // Ordinary hosting pages have no audit-status element or upload route.
                if ((row.status === 'loaded-and-updated' || row.event === 'ability-frame') && document.getElementById('audit-status')) {
                  try {
                    var probe = document.createElement('canvas');
                    probe.width = 64; probe.height = 36;
                    var context = probe.getContext('2d', {willReadFrequently: true});
                    context.drawImage(canvas, 0, 0, 64, 36);
                    var pixels = context.getImageData(0, 0, 64, 36).data, dark = 0;
                    for (var pixel = 0; pixel < pixels.length; pixel += 4) {
                      if (Math.max(pixels[pixel], pixels[pixel + 1], pixels[pixel + 2]) < 12) dark++;
                    }
                    var screenshot = canvas.toDataURL('image/jpeg', 0.6);
                    if (screenshot.length > 240000) screenshot = canvas.toDataURL('image/jpeg', 0.3);
                    if (screenshot.startsWith('data:image/jpeg;') && screenshot.length <= 240000) {
                      fetch('/__audit', {method: 'POST', headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({mode: window.portAuditState.mode,
                          row: {event: 'snapshot', sample: row.sample, seconds: row.seconds, blackFraction: dark / (64 * 36), suspectedBlackScreen: dark / (64 * 36) > 0.98, name: row.name, folder: row.folder, index: row.index, image: screenshot,
                            canvasSize: [canvas.width, canvas.height], devicePixelRatio: window.devicePixelRatio,
                            userAgent: navigator.userAgent}})
                      }).catch(function () {});
                    }
                  } catch (snapshotError) { console.warn('Audit snapshot unavailable', snapshotError); }
                }
              }
            } catch (error) { console.error('Audit recording failed', error); }
          }
		  if (String(message).startsWith('WEB_LEVEL_INITIALIZED')) {
		    window.portState.phase = 'level-initialized';
		    if (status) { status.textContent = ''; status.hidden = true; }
		  }
		  if (String(message).startsWith('Error:')) {
		    window.portState.error = String(message);
		    window.portState.phase = 'error';
		    if (status) { status.hidden = false; status.textContent = 'The game encountered an error.\n\n' + String(message); status.style.whiteSpace = 'pre-wrap'; status.style.fontSize = '14px'; status.style.overflow = 'auto'; }
		  }
		};
        Module.args = vargs;
        Module.cache = cache;

        // import packages
        Module.prerun = function() {
          Module.FS.mkdirTree('/usr/local/share/lua/5.1');
          for (var file in cache) {
            var cfile = cache[file];
            if (file == uri) {
              // game
              // Copy the entire loaded file into a spot in the heap (todo?)
              // Files will refer to slices in that. They cannot be freed though
              //var ptr = Module.malloc(cfile.length);
              //var ptr = Module.dynamicAlloc(cfile.length);
              //Module.HEAPU8.set(cfile, ptr);
              Module.FS.createDataFile('/', vargs[0], cfile, true, true, true);
            } else {
              // modules
              var fn = file.split('/').pop();
              Module.FS.createDataFile('/usr/local/share/lua/5.1', fn, cfile, true, true, true);
            }
          }
        };

        Module.postrun = function() {
          // hide the spinner
          canvas.style.display = 'block';
          canvas.focus();
          if (status) status.hidden = true;
          spinner.className = '';
        }
        
        if (window.Love === undefined) {
          // this operation initiates local storage
          Player.script(Player.version+'/love.js', function () {
            window.Love(Module);
          });
        } else {
          //Module.Browser.pauseMainLoop();
          window.Love(Module);
        }

        // capture commands
        if (Module._open)
          return;
        //Module._open = window.open;
        Module._open = window.open.bind(window);
        window.open = function(url) {
          // evaluate the JavaScript string
          if (url.startsWith('javascript:')) {
            url = url.substring(11);
            try {
              window._output = eval(url);
            } catch (e) {
              console.warn(e);
            }
            return;
          }
          return Module._open(url);
        }

        // the prompt can send UTF-8 strings to Lua synchronously
        window._output = null;
        //window.output = function(s) {
        //  _output = s;
        //}

        window.prompt = function(a) {
          var tmp = window._output;
          window._output = null;
          return tmp; // UTF8ToString(tmp);
        }
      })
      .catch(function (err) {
        console.error(err);
        var status = document.getElementById('status');
        if (status) { status.hidden = false; status.textContent = 'Loading failed: '+String(err); }
      })
  }
  
  // Event handling
  // Handling errors
  window.onerror = function (msg) {
    console.error(msg);
    if (spinner.className != '') {
      canvas.style.display = 'none';
      spinner.className = 'error';
    }
  };

  // Focus when running inside an iFrame
  window.onload = window.focus.bind(window);
  
  // Handle touch and mouse input
  window.onclick = window.ontouchstart = function (e) {
    window.focus();
  };
  
  // Disable scrolling while using the arrow keys
  var codes = [37, 38, 39, 40, 13];
  window.onkeydown = window.onkeyup = window.onkeypress = function (e) {
    if (codes.indexOf(e.keyCode || e.which || 0) > -1)
      e.preventDefault();
  }

  // Fix persistence issues when navigating back and forth
  window.onpageshow = function (event) {
    canvas.style.display = 'none';
    if (event.persisted)
      window.location.reload();
      //Player.start();
  };

  // Tries to sync the file-system when navigating away
  // This is not reliable, since async operations are not allowed at this point
  window.onbeforeunload = function(event) {
    // todo: love.event.exit when navigating away
    if (window.Module && window.Module.exit)
      window.Module.exit(0);
  };

  // Parse arguments from the URL address
  var url = new URL(script.src);
  if (!url.searchParams.has('g'))
    url = new URL(window.location.href);

  var search = url.searchParams;
  Player.version = search.get('v');
  if (search.get('n') == '1') {
    console.warn('disabling cache');
    Player.cache = false;
  }
  // ignore invalid version arguments
  if (Player.version != '11.5')
    Player.version = '11.5';
  
  var uri = search.get('g');
  if (uri == null)
    uri = 'nogame.love';
  
  var arg = search.get('arg');
  if (arg) {
    try {
      arg = JSON.parse(arg);
      if (!Array.isArray(arg)) {
        arg = [arg];
        for (var i = 0; i < arg.length; i++)
          arg[i] = String(arg[i]);
      }
    } catch (error) {
      console.warn(error);
    }
  }
  if (!Array.isArray(arg))
    arg = [];
  
  if (uri == 'norun')
    return;
  
  Player.start(uri, arg);
})();
