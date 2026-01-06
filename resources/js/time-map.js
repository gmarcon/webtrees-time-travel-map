document.addEventListener('DOMContentLoaded', function () {

    // If no root ID, we can't do anything.
    if (typeof ROOT_ID === 'undefined' || !ROOT_ID) {
        // Can happen if page loaded without parameters
        return;
    }

    // Initialize Map
    const map = L.map('map', {
        fullscreenControl: false, // We use custom control
    }).setView([20, 0], 2);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // Custom Fullscreen Control
    const FullscreenControl = L.Control.extend({
        options: {
            position: 'topleft'
        },
        onAdd: function (map) {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
            const button = L.DomUtil.create('a', 'leaflet-control-custom-fullscreen', container);
            button.href = '#';
            button.title = 'Toggle Fullscreen';
            button.innerHTML = FULLSCREEN_ICON_HTML || '⛶';

            L.DomEvent.on(button, 'click', function (e) {
                L.DomEvent.stopPropagation(e);
                L.DomEvent.preventDefault(e);
                toggleFullscreen();
            });

            return container;
        }
    });
    map.addControl(new FullscreenControl());

    function toggleFullscreen() {
        const wrapper = document.getElementById('time-travel-wrapper');

        if (!document.fullscreenElement) {
            if (wrapper.requestFullscreen) {
                wrapper.requestFullscreen().catch(err => {
                    console.error(`Error attempting to enable fullscreen: ${err.message}`);
                });
            } else if (wrapper.webkitRequestFullscreen) {
                wrapper.webkitRequestFullscreen();
            } else if (wrapper.msRequestFullscreen) {
                wrapper.msRequestFullscreen();
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
            }
        }
    }

    // Aggressive resizing check
    function checkMapSize() {
        if (map) {
            map.invalidateSize();
        }
    }

    ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'].forEach(evt => {
        document.addEventListener(evt, function () {
            // Check immediately and repeatedly for a short duration
            checkMapSize();
            setTimeout(checkMapSize, 100);
            setTimeout(checkMapSize, 300);
            setTimeout(checkMapSize, 500);
        });
    });

    // Controls
    const slider = document.getElementById('year-slider');
    const yearDisplay = document.getElementById('year-display');
    const playBtn = document.getElementById('play-btn');
    const pauseBtn = document.getElementById('pause-btn');
    const reverseBtn = document.getElementById('reverse-btn');
    const speedSelect = document.getElementById('speed-select');
    const loadingOverlay = document.getElementById('loading-overlay');
    const parentsCheck = document.getElementById('show-parents-check');
    const heatmapCheck = document.getElementById('show-heatmap-check');
    const autozoomCheck = document.getElementById('autozoom-check');

    let individuals = [];
    let visibleMarkers = {}; // Map of id -> L.marker
    let parentLines = []; // Array of L.polyline
    let heatmapLayer = null;
    let isPlaying = false;
    let playDirection = 1;
    let minYear = 1700;
    let maxYear = new Date().getFullYear();
    let currentYear = 1800;

    // Show loading
    function showLoading() {
        if (loadingOverlay) loadingOverlay.style.display = 'flex';
    }

    // Hide loading
    function hideLoading() {
        if (loadingOverlay) loadingOverlay.style.display = 'none';
    }

    // Create callout icon
    function createCalloutIcon(person) {
        const birth = person.yearFrom || '?';
        const death = person.yearTo || '?';

        return L.divIcon({
            className: 'custom-callout-icon',
            // Structure: Wrapper > Dot + Bubble
            html: `<div class="callout-wrapper">
                     <div class="callout-dot"></div>
                     <div class="callout-bubble">
                        ${person.name}<span class="years">(${birth}-${death})</span>
                     </div>
                   </div>`,
            iconSize: null,
            iconAnchor: [0, 0] // Wrapper handles positioning
        });
    }

    function getColorForPerson(id) {
        let hash = 0;
        for (let i = 0; i < id.length; i++) {
            hash = id.charCodeAt(i) + ((hash << 5) - hash);
        }
        const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
        return '#' + "00000".substring(0, 6 - c.length) + c;
    }

    // Load Data
    function loadData() {
        showLoading();

        const params = new URLSearchParams();
        params.append('root_person_id', ROOT_ID);
        params.append('direction', DIRECTION);
        params.append('generations', GENERATIONS); // If 0 (All)

        let fetchUrl = DATA_URL;
        if (fetchUrl.includes('?')) {
            fetchUrl += '&' + params.toString();
        } else {
            fetchUrl += '?' + params.toString();
        }

        fetch(fetchUrl)
            .then(response => response.json())
            .then(data => {
                hideLoading();
                if (data.error) {
                    alert(data.error);
                    return;
                }

                individuals = data.individuals || [];
                const meta = data.metadata || {};

                if (individuals.length === 0) {
                    alert("No data found for this person/criteria.");
                    return;
                }

                // Update Timeline Range
                if (meta.min_year && meta.max_year) {
                    minYear = meta.min_year;
                    maxYear = meta.max_year;
                } else {
                    minYear = 1700;
                    maxYear = new Date().getFullYear();
                }

                slider.min = minYear;
                slider.max = maxYear;

                // Initial Slider Position
                if (DIRECTION === 'DOWN') {
                    slider.value = minYear;
                    playDirection = 1;
                } else {
                    slider.value = maxYear;
                    playDirection = -1;
                }
                currentYear = parseInt(slider.value);
                yearDisplay.innerText = currentYear;

                // Fit bounds initially
                fitBoundsToAll();

                updateMap(currentYear);
            })
            .catch(err => {
                hideLoading();
                console.error('Error loading data:', err);
                alert('Error loading data. See console for details.');
            });
    }

    function fitBoundsToAll() {
        let allLat = [];
        let allLng = [];
        individuals.forEach(ind => {
            ind.events.forEach(e => {
                allLat.push(e.coords[0]);
                allLng.push(e.coords[1]);
            });
        });
        if (allLat.length > 0) {
            const bounds = L.latLngBounds(
                [Math.min(...allLat), Math.min(...allLng)],
                [Math.max(...allLat), Math.max(...allLng)]
            );
            map.fitBounds(bounds, { padding: [50, 50] });
        }
    }

    function getPositionAtYear(person, year) {
        const validEvents = person.events.filter(e => e.coords && e.coords.length === 2);
        if (validEvents.length === 0) return null;

        let bestEvent = null;
        for (let i = 0; i < validEvents.length; i++) {
            if (validEvents[i].year <= year) {
                bestEvent = validEvents[i];
            } else {
                break; // Events are sorted by year
            }
        }

        if (!bestEvent) {
            if (person.yearFrom && year >= person.yearFrom) {
                return { lat: validEvents[0].coords[0], lng: validEvents[0].coords[1], event: validEvents[0] };
            }
            return null;
        }

        return { lat: bestEvent.coords[0], lng: bestEvent.coords[1], event: bestEvent };
    }

    function updateMap(year) {
        // 1. Update/Add/Remove Markers
        const activePeople = [];
        const activeCoords = [];

        individuals.forEach(person => {
            const birth = person.yearFrom || -9999;
            const death = person.yearTo || 9999;

            if (year < birth || year > death) {
                if (visibleMarkers[person.id]) {
                    map.removeLayer(visibleMarkers[person.id]);
                    delete visibleMarkers[person.id];
                }
                return;
            }

            const pos = getPositionAtYear(person, year);
            if (!pos) {
                if (visibleMarkers[person.id]) {
                    map.removeLayer(visibleMarkers[person.id]);
                    delete visibleMarkers[person.id];
                }
                return;
            }

            activePeople.push({ person, pos });
            activeCoords.push([pos.lat, pos.lng]);

            if (visibleMarkers[person.id]) {
                const marker = visibleMarkers[person.id];
                const oldLatLng = marker.getLatLng();
                const newLatLng = new L.LatLng(pos.lat, pos.lng);

                if (oldLatLng.distanceTo(newLatLng) > 10) {
                    marker.setLatLng(newLatLng);
                }
            } else {
                const marker = L.marker([pos.lat, pos.lng], {
                    icon: createCalloutIcon(person)
                });

                marker.on('click', () => {
                    const content = buildPopupContent(person);
                    marker.bindPopup(content, { maxWidth: 350, minWidth: 250 }).openPopup();
                });

                marker.addTo(map);
                visibleMarkers[person.id] = marker;
            }
        });

        // 2. Handle Parent Lines
        if (parentsCheck && parentsCheck.checked) {
            drawParentLines(activePeople);
        } else {
            clearParentLines();
        }

        // 3. Handle Heatmap
        if (heatmapCheck && heatmapCheck.checked) {
            drawHeatmap(activePeople);
        } else {
            if (heatmapLayer) {
                map.removeLayer(heatmapLayer);
                heatmapLayer = null;
            }
        }

        // 4. Handle Autozoom
        if (autozoomCheck && autozoomCheck.checked) {
            if (activeCoords.length > 0) {
                const bounds = L.latLngBounds(activeCoords);
                // Animate zoom
                map.fitBounds(bounds, { padding: [100, 100], animate: true, duration: 1 });
            }
        }
    }

    function buildPopupContent(person) {
        const birth = person.yearFrom || '?';
        const death = person.yearTo || '?';

        let html = `<div class="custom-popup" style="overflow:hidden;">`;

        // Thumbnail
        if (person.thumb) {
            html += `<img src="${person.thumb}" class="popup-thumbnail" alt="Thumb">`;
        }

        html += `<h6 style="margin-bottom:0; font-weight:bold;">
                    <a href="${person.url}" target="_parent">${person.name}</a> 
                    <span style="font-weight:normal;">(${birth}-${death})</span>
                 </h6>
            <div style="clear:both;"></div>
            <hr style="margin:5px 0;">
            <div class="event-list" style="max-height: 250px; overflow-y: auto;">`;

        person.events.forEach(ev => {
            const place = ev.location || '';
            const date = ev.GEDdate || '';
            // Format: Year Type in Place (Date)
            html += `<div class="event-item" style="margin-bottom: 4px;">
                <span style="font-weight:bold;">${ev.year}</span> ${ev.event_label}`;

            if (place) {
                html += ` in <span class="text-muted">${place}</span>`;
            }
            if (date) {
                html += ` <small class="text-muted">(${date})</small>`;
            }
            html += `</div>`;
        });

        html += `</div></div>`;
        return html;
    }

    function clearParentLines() {
        parentLines.forEach(l => map.removeLayer(l));
        parentLines = [];
    }

    function drawParentLines(activePeople) {
        clearParentLines();

        const activePos = {};
        activePeople.forEach(ap => activePos[ap.person.id] = ap.pos);

        activePeople.forEach(ap => {
            const p = ap.person;
            const from = ap.pos;

            if (p.father && activePos[p.father]) {
                const to = activePos[p.father];
                const line = L.polyline([[from.lat, from.lng], [to.lat, to.lng]], {
                    color: '#333',
                    weight: 1.5,
                    opacity: 0.5,
                    dashArray: '4, 4'
                }).addTo(map);
                parentLines.push(line);
            }
            if (p.mother && activePos[p.mother]) {
                const to = activePos[p.mother];
                const line = L.polyline([[from.lat, from.lng], [to.lat, to.lng]], {
                    color: '#333',
                    weight: 1.5,
                    opacity: 0.5,
                    dashArray: '4, 4'
                }).addTo(map);
                parentLines.push(line);
            }
        });
    }

    function drawHeatmap(activePeople) {
        if (!L.heatLayer) {
            console.warn('Leaflet.heat not loaded');
            return;
        }

        const points = activePeople.map(ap => [ap.pos.lat, ap.pos.lng, 1.0]);

        if (heatmapLayer) {
            heatmapLayer.setLatLngs(points);
        } else {
            heatmapLayer = L.heatLayer(points, {
                radius: 35,
                blur: 20,
                maxZoom: 10,
            }).addTo(map);
        }
    }

    // Playback Logic
    function step() {
        if (!isPlaying) return;

        currentYear = parseInt(slider.value);

        if (playDirection === 1 && currentYear >= maxYear) {
            isPlaying = false;
            return;
        }
        if (playDirection === -1 && currentYear <= minYear) {
            isPlaying = false;
            return;
        }

        slider.value = currentYear + playDirection;
        yearDisplay.innerText = slider.value;
        updateMap(parseInt(slider.value));

        const speed = parseInt(speedSelect.value);
        const baseDelay = 500;
        const delay = baseDelay / speed;

        setTimeout(() => {
            requestAnimationFrame(step);
        }, delay);
    }

    if (playBtn) {
        playBtn.addEventListener('click', () => {
            playDirection = 1;
            if (isPlaying) return;
            isPlaying = true;
            step();
        });
    }

    if (reverseBtn) {
        reverseBtn.addEventListener('click', () => {
            playDirection = -1;
            if (isPlaying) return;
            isPlaying = true;
            step();
        });
    }

    if (pauseBtn) {
        pauseBtn.addEventListener('click', () => {
            isPlaying = false;
        });
    }

    if (slider) {
        slider.addEventListener('input', () => {
            yearDisplay.innerText = slider.value;
            updateMap(parseInt(slider.value));
        });
    }

    // Event Listeners for new controls
    if (parentsCheck) {
        parentsCheck.addEventListener('change', () => {
            updateMap(parseInt(slider.value));
        });
    }

    if (heatmapCheck) {
        heatmapCheck.addEventListener('change', () => {
            updateMap(parseInt(slider.value));
        });
    }

    if (autozoomCheck) {
        autozoomCheck.addEventListener('change', () => {
            updateMap(parseInt(slider.value));
        });
    }

    // Start
    loadData();
});
