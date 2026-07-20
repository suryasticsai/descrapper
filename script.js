(function() {
    'use strict';

    // ─── askLLM with robust fallback (unchanged) ──────────────
    window.askLLM = async function(prompt, model, fallbackKeywords) {
        const maxRetries = 2;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await fetch('https://ragina-crawler-ragina.vercel.app/api/ask', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'Accept-Encoding': 'identity'
                    },
                    body: JSON.stringify({ prompt })
                });
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error('HTTP ' + response.status + ': ' + errorText.slice(0, 200));
                }
                let rawText = await response.text();
                if (rawText.charCodeAt(0) === 0xFEFF) rawText = rawText.slice(1);
                window.__lastRawLLMResponse = rawText;
                let data;
                try {
                    data = JSON.parse(rawText);
                } catch (e) {
                    if (rawText.length > 10 && !rawText.startsWith('{') && !rawText.startsWith('[')) {
                        const cleaned = cleanText(rawText);
                        if (cleaned && cleaned.length > 10) return cleaned;
                    }
                    throw new Error('Response is not valid JSON: ' + rawText.slice(0, 100));
                }
                if (data.text) {
                    const textContent = data.text;
                    const cleaned = cleanText(textContent);
                    const garbageCount = (textContent.match(/�/g) || []).length;
                    const controlCount = (textContent.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g) ||
                        []).length;
                    const totalChars = textContent.length || 1;
                    const garbageRatio = (garbageCount + controlCount) / totalChars;
                    if (garbageRatio > 0.3 || cleaned.length < 10) {
                        const extracted = extractReadableText(textContent);
                        if (extracted && extracted.length > 10) return extracted;
                        if (attempt < maxRetries) {
                            console.warn('Attempt ' + attempt + ' returned garbled response. Retrying...');
                            continue;
                        }
                        return generateFallback(prompt, fallbackKeywords);
                    }
                    return cleaned;
                }
                if (data.error) throw new Error(data.error);
                const cleanedRaw = cleanText(rawText);
                if (cleanedRaw && cleanedRaw.length > 10) return cleanedRaw;
                return generateFallback(prompt, fallbackKeywords);
            } catch (error) {
                if (attempt === maxRetries) {
                    console.error('LLM error after retries:', error);
                    return generateFallback(prompt, fallbackKeywords);
                }
                console.warn('Attempt ' + attempt + ' failed, retrying...');
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        return generateFallback(prompt, fallbackKeywords);
    };

    function generateFallback(prompt, keywords) {
        if (!keywords || keywords.length === 0) {
            return "Unable to generate content. Please try again later.";
        }
        var keywordList = keywords.slice(0, 6).join(', ');
        var lowerPrompt = prompt.toLowerCase();
        if (lowerPrompt.indexOf('professional summary') !== -1) {
            return 'Experienced professional with a strong background in ' + keywordList +
                '. Proven track record of delivering high-quality results in fast-paced environments. Passionate about leveraging technology to drive business value and team success.';
        } else if (lowerPrompt.indexOf('technical skills') !== -1) {
            return keywords.slice(0, 12).join(', ');
        } else if (lowerPrompt.indexOf('experience') !== -1) {
            return '\u2022 Senior ' + (keywords[0] || 'Professional') +
                ' at Leading Company (2020\u2013Present)\n  \u2013 Led initiatives leveraging ' +
                keywordList + ', resulting in measurable improvements.\n  \u2013 Collaborated with cross-functional teams to deliver projects on time.\n  \u2013 Implemented best practices that enhanced team productivity and quality.';
        } else if (lowerPrompt.indexOf('projects') !== -1) {
            return '\u2022 ' + (keywords[0] || 'Key') +
                ' Project: Developed a solution using ' + keywordList +
                ', achieving significant efficiency gains.\n\u2022 Another Project: Implemented a system that improved data processing and reporting.';
        } else if (lowerPrompt.indexOf('education') !== -1) {
            return 'Bachelor of Science in Computer Science, University (2018\u20132022)\nCoursework: Data Structures, Algorithms, Software Engineering, Database Systems.';
        } else if (lowerPrompt.indexOf('certifications') !== -1) {
            return '\u2022 Certified ' + (keywords[0] || 'Professional') +
                ' (Issuing Body, Year)\n\u2022 Certified ' + (keywords[1] || 'Specialist') +
                ' (Issuing Body, Year)';
        } else {
            return 'Generated content using keywords: ' + keywordList +
                '. Please refine with specific prompts.';
        }
    }

    function extractReadableText(text) {
        const words = text.match(/[A-Za-z]{3,}/g);
        if (words && words.length > 0) {
            let result = words.join(' ');
            result = result.replace(/\s+/g, ' ').trim();
            if (result.length > 10) return result;
        }
        const printable = text.match(/[A-Za-z0-9\s,.!?\-:;'"()]{10,}/g);
        if (printable && printable.length > 0) return printable.join(' ').trim();
        return '';
    }

    function cleanText(text) {
        if (!text) return '';
        text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
        text = text.replace(/�/g, '');
        text = text.replace(/=H\s*sN\s*z/g, '');
        text = text.replace(/\x1E/g, '');
        text = text.replace(/\x10/g, '');
        text = text.replace(/\x12/g, '');
        text = text.replace(/\x18/g, '');
        text = text.replace(/\x17/g, '');
        const lines = text.split('\n').filter(l => l.trim());
        const instructionKeywords = [
            'please', 'note:', 'requirements:', 'output only', 'no extra',
            'extract the', 'go ahead', 'thank you', 'format as', 'include',
            'use only', 'do not', 'make it', 'keep it', 'list the',
            'for each', 'with clear', 'use action', 'output in', 'focus on'
        ];
        const filtered = lines.filter(line => {
            const lower = line.toLowerCase();
            const isInstruction = instructionKeywords.some(kw => lower.includes(kw) && lower.length < 80);
            const isDash = /^[-—]{3,}$/.test(line.trim());
            return !isInstruction && !isDash;
        });
        let result = filtered.join('\n').trim();
        if (!result) {
            const allLines = lines;
            const startIdx = allLines.findIndex(line => {
                const lower = line.toLowerCase();
                return instructionKeywords.every(kw => !lower.includes(kw)) && line.length > 10;
            });
            if (startIdx !== -1) {
                result = allLines.slice(startIdx).join('\n').trim();
            } else {
                result = text;
            }
        }
        result = result.replace(/^[-—]+\s*/, '').replace(/\s*[-—]+$/, '');
        return result;
    }

    function escapeText(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ─── DOM refs ──────────────────────────────────────────────
    const urlInput = document.getElementById('urlInput');
    const fetchBtn = document.getElementById('fetchBtn');
    const clearBtn = document.getElementById('clearBtn');
    const generateBtn = document.getElementById('generateBtn');
    const statusBadge = document.getElementById('statusBadge');
    const statusText = document.getElementById('statusText');
    const retryText = document.getElementById('retryText');
    const jdContainer = document.getElementById('jdContainer');
    const logArea = document.getElementById('logArea');
    const resumeDrop = document.getElementById('resumeDrop');
    const resumeFileInput = document.getElementById('resumeFileInput');
    const resumeFileName = document.getElementById('resumeFileName');
    const debugToggleBtn = document.getElementById('debugToggleBtn');
    const debugContainer = document.getElementById('debugContainer');
    const contentContainer = document.getElementById('contentContainer');
    const sectionsContainer = document.getElementById('sectionsContainer');
    const modeBadge = document.getElementById('modeBadge');
    const pasteJdBtn = document.getElementById('pasteJdBtn');
    const pasteJdRow = document.getElementById('pasteJdRow');
    const pasteJdTextarea = document.getElementById('pasteJdTextarea');
    const usePastedJdBtn = document.getElementById('usePastedJdBtn');
    const cancelPasteJdBtn = document.getElementById('cancelPasteJdBtn');
    const copyAllBtn = document.getElementById('copyAllBtn');
    const downloadResumeBtn = document.getElementById('downloadResumeBtn');
    const resumePreviewContainer = document.getElementById('resumePreviewContainer');
    const resumePreviewGrid = document.getElementById('resumePreviewGrid');
    const toggleResumePreviewBtn = document.getElementById('toggleResumePreviewBtn');
    const fetchFailSuggestion = document.getElementById('fetchFailSuggestion');
    const fetchPersonalInfoBtn = document.getElementById('fetchPersonalInfoBtn');
    const saveResumeBtn = document.getElementById('saveResumeBtn');
    const clearResumeBtn = document.getElementById('clearResumeBtn');
    const downloadJsonBtn = document.getElementById('downloadJsonBtn');
    const consoleToggle = document.getElementById('consoleToggle');
    const jdToggleLabel = document.getElementById('jdToggleLabel');
    const jdContent = document.getElementById('jdContent');
    const jdArrow = document.getElementById('jdArrow');

    const progressOverlay = document.getElementById('progressOverlay');
    const progressFill = document.getElementById('progressFill');
    const progressAttempt = document.getElementById('progressAttempt');
    const progressProxy = document.getElementById('progressProxy');
    const progressSubtitle = document.getElementById('progressSubtitle');
    const progressCancelBtn = document.getElementById('progressCancelBtn');

    const atsPreviewContainer = document.getElementById('atsPreviewContainer');
    const atsIframe = document.getElementById('atsIframe');
    const downloadAtsHtmlBtn = document.getElementById('downloadAtsHtmlBtn');
    const printAtsPdfBtn = document.getElementById('printAtsPdfBtn');
    const toggleAtsPreviewBtn = document.getElementById('toggleAtsPreviewBtn');

    consoleToggle.addEventListener('change', function() {
        logArea.classList.toggle('hidden-log', !this.checked);
    });

    let jdOpen = false;
    jdToggleLabel.addEventListener('click', function() {
        jdOpen = !jdOpen;
        jdContent.classList.toggle('open', jdOpen);
        jdArrow.classList.toggle('open', jdOpen);
    });

    const state = {
        jobDescription: null,
        jobKeywords: [],
        resumeText: '',
        resumeStructured: null,
        sections: { summary: '', skills: '', experience: '', projects: '', education: '', certifications: '' },
        isProcessing: false,
        engine: null,
        hasResume: false,
        fetchCancelled: false,
    };

    // ─── Logging ────────────────────────────────────────────────
    function log(message, level) {
        level = level || 'info';
        const time = new Date().toLocaleTimeString();
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.innerHTML = '<span class="time">[' + time + ']</span> <span class="level ' + level + '">' + level
            .toUpperCase() + '</span> ' + message;
        logArea.appendChild(entry);
        logArea.scrollTop = logArea.scrollHeight;
        if (level === 'error') setStatus('Error', 'error');
        else if (level === 'success') setStatus('Success', 'success');
        else if (level === 'warn') setStatus('Warning', 'warn');
        else setStatus('Loading...', 'loading');
        statusText.textContent = message;
        if (level === 'error' && (message.includes('fetch') || message.includes('JobScraper'))) {
            fetchFailSuggestion.style.display = 'block';
        }
    }

    function setStatus(text, type) {
        statusBadge.textContent = text;
        statusBadge.className = 'status-badge';
        if (type) statusBadge.classList.add(type);
    }

    function showProgress() {
        state.fetchCancelled = false;
        progressOverlay.classList.add('active');
        progressFill.style.width = '0%';
        progressSubtitle.textContent = 'Connecting to JobScraper...';
        progressAttempt.textContent = 'Processing...';
        progressProxy.textContent = 'JobScraper';
    }

    function hideProgress() {
        progressOverlay.classList.remove('active');
    }

    function updateProgress(percent, subtitle) {
        progressFill.style.width = Math.min(percent, 95) + '%';
        if (subtitle) progressSubtitle.textContent = subtitle;
    }

    progressCancelBtn.addEventListener('click', function() {
        state.fetchCancelled = true;
        hideProgress();
        log('Fetch cancelled by user.', 'warn');
        setStatus('Cancelled', '');
        statusText.textContent = 'Fetch cancelled. Try again or paste JD manually.';
        fetchBtn.disabled = false;
        fetchBtn.innerHTML = '<i class="fas fa-cloud-download-alt"></i> Fetch JD';
    });

    // ─── RAGina init ──────────────────────────────────────────
    function initRAGina() {
        if (typeof window.RAGina === 'undefined') {
            log('RAGina not loaded.', 'error');
            return false;
        }
        try {
            if (!window.RAGina.engine) window.RAGina.init({});
            state.engine = window.RAGina.getEngine();
            if (!state.engine) {
                log('Failed to get RAG engine.', 'error');
                return false;
            }
            log('RAGina engine initialized.', 'success');
            return true;
        } catch (e) {
            log('RAGina init error: ' + e.message, 'error');
            return false;
        }
    }

    // ─── Fetch using JobScraper ──────────────────────────────
    async function fetchWithJobScraper(url) {
        showProgress();
        updateProgress(10, 'Initializing JobScraper...');

        try {
            if (typeof JobScraper === 'undefined') {
                throw new Error('JobScraper library not loaded. Please check your internet connection.');
            }

            updateProgress(30, 'Fetching and parsing job description...');
            log('Calling JobScraper.generateResume() for: ' + url, 'info');

            const result = await JobScraper.generateResume(url);

            updateProgress(80, 'Processing job data...');

            if (result.error) {
                throw new Error(result.error);
            }

            state.jobDescription = result;

            // Extract keywords from globalTags and sections
            const allKeywords = [...(result.globalTags || [])];
            if (result.sections) {
                result.sections.forEach(section => {
                    if (section.tags) {
                        section.tags.forEach(tag => {
                            if (!allKeywords.includes(tag)) allKeywords.push(tag);
                        });
                    }
                });
            }
            state.jobKeywords = allKeywords.slice(0, 20);

            renderJobDescription(result);

            log('Job fetched successfully: ' + result.job.title, 'success');
            log('Keywords: ' + state.jobKeywords.join(', '), 'info');
            setStatus('Success', 'success');
            statusText.textContent = 'JD loaded: ' + result.job.title + ' (' + result.job.company + ')';
            updateGenerateButton();
            fetchFailSuggestion.style.display = 'none';
            hideProgress();
            return true;

        } catch (error) {
            console.error('JobScraper error:', error);
            log('JobScraper error: ' + error.message, 'error');
            setStatus('Error', 'error');
            statusText.textContent = 'Failed: ' + error.message;
            fetchFailSuggestion.style.display = 'block';
            hideProgress();
            return false;
        }
    }

    // ─── Render Job Description from JobScraper result ──────
    function renderJobDescription(result) {
        if (!result || !result.fullDescription) {
            jdContainer.innerHTML =
                '<div style="color:#8a9aaa; font-style:italic; padding:20px 0; text-align:center;">No job description available.</div>';
            return;
        }

        const jd = result.job || {};
        const fullDesc = result.fullDescription || '';
        const sections = result.sections || [];
        const globalTags = result.globalTags || [];

        let html = '';
        html += '<div class="jd-card">';
        html += '<div class="card-label"><i class="fas fa-info-circle"></i> Job Description</div>';
        html += '<div class="jd-meta">';
        if (jd.company) html += '<strong>' + escapeText(jd.company) + '</strong>';
        if (jd.title) html += ' &mdash; ' + escapeText(jd.title);
        if (jd.status) html += ' | Status: ' + escapeText(jd.status);
        html += '</div>';

        if (fullDesc) {
            html += '<div style="margin-top:8px; line-height:1.6; white-space:pre-wrap;">' + escapeText(fullDesc) +
                '</div>';
        }

        if (sections.length > 0) {
            html += '<div style="margin-top:16px;"><strong>📋 Sections:</strong></div>';
            sections.forEach(function(section) {
                if (section.content && section.content.trim().length > 0) {
                    html +=
                        '<div style="margin-top:8px; padding:8px 12px; background:rgba(201,168,76,0.06); border-left:3px solid #c9a84c;">';
                    html += '<div style="font-weight:600; font-size:0.85rem;">' + escapeText(section.name) +
                        '</div>';
                    html += '<div style="font-size:0.85rem; color:#4a5a6a;">' + escapeText(section.content) +
                        '</div>';
                    if (section.tags && section.tags.length > 0) {
                        html += '<div style="margin-top:4px;">';
                        section.tags.forEach(function(tag) {
                            html += '<span class="keyword-chip">' + escapeText(tag) + '</span>';
                        });
                        html += '</div>';
                    }
                    html += '</div>';
                }
            });
        }

        if (globalTags.length > 0) {
            html += '<div style="margin-top:12px;"><strong>🏷️ Global Tags:</strong> ';
            globalTags.forEach(function(tag) {
                html += '<span class="keyword-chip">' + escapeText(tag) + '</span>';
            });
            html += '</div>';
        }

        html += '</div>';
        jdContainer.innerHTML = html;
    }

    // ─── Resume parsing – improved name & bullet extraction ──
    async function parseResumeWithAI(text) {
        var prompt = 'You are an expert resume parser. Extract the following fields from the resume text below.\n' +
            'Return ONLY a valid JSON object with exactly these keys:\n' +
            '{\n  "fullName": "",\n  "email": "",\n  "phone": "",\n  "location": "",\n  "linkedin": "",\n  "github": "",\n  "summary": "",\n  "skills": "",\n  "experience": [\n    { "title": "", "company": "", "location": "", "dates": "", "bullets": [] }\n  ],\n  "education": "",\n  "certifications": "",\n  "projects": []\n}\n\n' +
            'Rules:\n- If a field is not found, use an empty string or empty array.\n' +
            '- For experience, extract each job as a separate object. Bullets should be a list of achievement strings.\n' +
            '- For skills, combine all technical and soft skills into a single comma-separated string.\n' +
            '- For projects, list each project as a string (title and brief description).\n' +
            '- Output ONLY the JSON, no extra text or explanation.\n\nResume text:\n' + text;
        try {
            var result = await window.askLLM(prompt, 'openai', []);
            var cleaned = result.trim();
            cleaned = cleaned.replace(/```json\s*/g, '').replace(/```\s*/g, '');
            var parsed = JSON.parse(cleaned);
            return {
                personalInfo: {
                    fullName: parsed.fullName || '',
                    email: parsed.email || '',
                    phone: parsed.phone || '',
                    location: parsed.location || '',
                    linkedin: parsed.linkedin || '',
                    github: parsed.github || '',
                },
                summary: parsed.summary || '',
                skills: parsed.skills || '',
                experience: parsed.experience || [],
                education: parsed.education || '',
                certifications: parsed.certifications || '',
                projects: parsed.projects || []
            };
        } catch (e) {
            log('AI parser error: ' + e.message, 'warn');
            return null;
        }
    }

    // Enhanced parser with better name detection
    function enhancedResumeParser(text) {
        var lines = text.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
        var doc = nlp(text);
        var email = (text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/) || [])[0] || '';
        var phone = (text.match(/\+?[\d\s\-()]{8,}/) || [])[0] || '';
        var linkedin = (text.match(/linkedin\.com\/in\/[a-zA-Z0-9\-]+/i) || [])[0] || '';
        var github = (text.match(/github\.com\/[a-zA-Z0-9\-]+/i) || [])[0] || '';

        // Improved name extraction: capture only the first 2-3 capitalized words
        var name = '';
        for (var nl = 0; nl < Math.min(lines.length, 20); nl++) {
            var line = lines[nl];
            var nameMatch = line.match(/^([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
            if (nameMatch && nameMatch[1].length < 50) {
                name = nameMatch[1];
                break;
            }
        }
        if (!name) {
            for (var nl2 = 0; nl2 < Math.min(lines.length, 10); nl2++) {
                var line2 = lines[nl2];
                var simpleMatch = line2.match(/^[A-Z][a-z]+\s+[A-Z][a-z]+/);
                if (simpleMatch && simpleMatch[0].length < 40) {
                    name = simpleMatch[0];
                    break;
                }
            }
        }

        var locations = ['Hyderabad', 'Bangalore', 'Mumbai', 'Delhi', 'Chennai', 'Pune', 'India',
            'San Francisco', 'New York', 'Austin', 'London', 'Singapore', 'Seattle', 'Chicago', 'Boston', 'Toronto',
            'Sydney'
        ];
        var location = '';
        for (var loc = 0; loc < locations.length; loc++) {
            if (text.includes(locations[loc])) { location = locations[loc]; break; }
        }

        var sectionMap = {
            summary: ['summary', 'profile', 'about me', 'objective'],
            experience: ['experience', 'work', 'employment', 'career history', 'professional experience'],
            education: ['education', 'academic', 'qualification', 'studies'],
            skills: ['skills', 'technical skills', 'competencies', 'expertise', 'core skills'],
            projects: ['projects', 'personal projects', 'side projects'],
            certifications: ['certifications', 'certificates', 'licenses']
        };
        var currentSection = 'other';
        var sections = { summary: [], experience: [], education: [], skills: [], projects: [], certifications: [] };
        var headingIndices = [];
        for (var hi = 0; hi < lines.length; hi++) {
            var line = lines[hi];
            var lower = line.toLowerCase();
            var isAllCaps = /^[A-Z\s\-]{4,}$/.test(line);
            var endsWithColon = /:$/.test(line);
            var isShort = line.length < 60;
            if (isShort && (isAllCaps || endsWithColon)) {
                headingIndices.push(hi);
                continue;
            }
            var matched = false;
            for (var key in sectionMap) {
                if (sectionMap[key].some(function(kw) { return lower.includes(kw) && isShort; })) {
                    headingIndices.push(hi);
                    matched = true;
                    break;
                }
            }
            if (matched) continue;
        }
        for (var li = 0; li < lines.length; li++) {
            var line2 = lines[li];
            if (headingIndices.indexOf(li) !== -1) {
                var lower2 = line2.toLowerCase();
                var found = false;
                for (var key2 in sectionMap) {
                    if (sectionMap[key2].some(function(kw2) { return lower2.includes(kw2); })) {
                        currentSection = key2;
                        found = true;
                        break;
                    }
                }
                if (!found) currentSection = 'other';
                continue;
            }
            if (/^[-\u2014]{2,}$/.test(line2)) continue;
            if (sections[currentSection]) {
                sections[currentSection].push(line2);
            }
        }

        function parseExperience(expLines) {
            var result = [];
            var current = null;
            for (var el = 0; el < expLines.length; el++) {
                var line3 = expLines[el];
                // Improved bullet detection: include common bullet characters
                var isBullet = /^[\u2022\u2023\u2043\uF0B7\-\u2013\u2014]\s*/.test(line3);
                var isDash = /\u2014|\u2013/.test(line3);
                var isAt = /\s+at\s+/i.test(line3);
                var hasDates = /\d{4}\s*[-\u2013]\s*(present|\d{4})/i.test(line3);
                var isCapWithDates = /^[A-Z][a-zA-Z\s]+/.test(line3) && hasDates;

                if (isDash || isAt || isCapWithDates) {
                    if (current) result.push(current);
                    var title = '',
                        company = '';
                    if (isDash) {
                        var parts = line3.split(/\u2014|\u2013/);
                        if (parts.length === 2) {
                            var left = parts[0].trim();
                            var right = parts[1].trim();
                            if (/[A-Z]{2,}/.test(left) && right.length > 0) {
                                company = left;
                                title = right;
                            } else {
                                title = left;
                                company = right;
                            }
                        } else {
                            title = line3;
                        }
                    } else if (isAt) {
                        var parts2 = line3.split(/\s+at\s+/i);
                        title = parts2[0].trim();
                        company = parts2[1] ? parts2[1].trim() : '';
                    } else {
                        title = line3;
                    }
                    var dates = '';
                    var dateMatch = line3.match(/\d{4}\s*[-\u2013]\s*(present|\d{4})/i);
                    if (dateMatch) dates = dateMatch[0];
                    if (dates) {
                        title = title.replace(/\d{4}\s*[-\u2013]\s*(present|\d{4})/i, '').trim();
                        company = company.replace(/\d{4}\s*[-\u2013]\s*(present|\d{4})/i, '').trim();
                    }
                    current = { title: title, company: company, location: '', dates: dates, bullets: [] };
                } else if (current) {
                    if (isBullet) {
                        current.bullets.push(line3.replace(/^[\u2022\u2023\u2043\uF0B7\-\u2013\u2014]\s*/, ''));
                    } else if (/\d{4}\s*[-\u2013]\s*(present|\d{4})/i.test(line3) && !current.dates) {
                        current.dates = line3;
                    } else if (line3.match(/^[A-Z][a-z]+,\s*[A-Z]{2}/) && !current.location) {
                        current.location = line3;
                    } else if (line3.length > 5 && !/^[A-Z\s]{4,}$/.test(line3)) {
                        current.bullets.push(line3);
                    }
                }
            }
            if (current) result.push(current);
            return result;
        }
        var experience = parseExperience(sections.experience);
        var structured = {
            personalInfo: { fullName: name, email: email, phone: phone, location: location, linkedin: linkedin,
                github: github },
            summary: sections.summary.join(' '),
            skills: sections.skills.join(', ').replace(/,\s*,/g, ',').replace(/^[, ]+/, '').replace(/[, ]+$/, ''),
            experience: experience,
            education: sections.education.join('\n'),
            certifications: sections.certifications.join('\n'),
            projects: sections.projects
        };
        if (!structured.skills) {
            var toolsMatch = text.match(/TOOLS & PLATFORMS([\s\S]*?)(?=\n\n|\n[A-Z]{4,})/i);
            if (toolsMatch) {
                structured.skills = toolsMatch[1].replace(/\n/g, ', ').replace(/,\s*,/g, ',').trim();
            }
        }
        return structured;
    }

    // Simple parser with improved name extraction
    function parseResumeSimple(text) {
        var lines = text.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l; });
        var resume = {
            personalInfo: { fullName: '', email: '', phone: '', location: '', linkedin: '', github: '' },
            summary: '',
            skills: '',
            experience: [],
            education: '',
            certifications: '',
            projects: []
        };

        // Improved name detection
        var nameFound = false;
        for (var ni = 0; ni < Math.min(lines.length, 20); ni++) {
            var line = lines[ni];
            var nameMatch = line.match(/^([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
            if (nameMatch && nameMatch[1].length < 50) {
                resume.personalInfo.fullName = nameMatch[1];
                nameFound = true;
                break;
            }
        }
        if (!nameFound) {
            for (var ni2 = 0; ni2 < Math.min(lines.length, 10); ni2++) {
                var line2 = lines[ni2];
                var simpleMatch = line2.match(/^[A-Z][a-z]+\s+[A-Z][a-z]+/);
                if (simpleMatch && simpleMatch[0].length < 40) {
                    resume.personalInfo.fullName = simpleMatch[0];
                    nameFound = true;
                    break;
                }
            }
        }

        var emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (emailMatch) resume.personalInfo.email = emailMatch[0];
        var phoneMatch = text.match(/\+?[\d\s\-()]{8,}/);
        if (phoneMatch) resume.personalInfo.phone = phoneMatch[0];
        var linkedinMatch = text.match(/linkedin\.com\/in\/[a-zA-Z0-9\-]+/i);
        if (linkedinMatch) resume.personalInfo.linkedin = linkedinMatch[0];
        var githubMatch = text.match(/github\.com\/[a-zA-Z0-9\-]+/i);
        if (githubMatch) resume.personalInfo.github = githubMatch[0];
        var locMatch = text.match(/(Hyderabad|Bangalore|Mumbai|Delhi|Chennai|Pune|India)/i);
        if (locMatch) resume.personalInfo.location = locMatch[0];

        var currentSection = 'summary';
        var currentExp = null;
        var expBullets = [];
        for (var ri = 0; ri < lines.length; ri++) {
            var lower = lines[ri].toLowerCase();
            if (lower.includes('summary') || lower.includes('profile')) {
                currentSection = 'summary';
                continue;
            } else if (lower.includes('experience') || lower.includes('work') || lower.includes('employment')) {
                currentSection = 'experience';
                if (currentExp) {
                    resume.experience.push(Object.assign({}, currentExp, { bullets: expBullets }));
                    currentExp = null;
                    expBullets = [];
                }
                continue;
            } else if (lower.includes('skill') || lower.includes('competencies')) {
                currentSection = 'skills';
                continue;
            } else if (lower.includes('education')) {
                currentSection = 'education';
                continue;
            } else if (lower.includes('certif')) {
                currentSection = 'certifications';
                continue;
            } else if (lower.includes('project')) {
                currentSection = 'projects';
                continue;
            } else {
                if (currentSection === 'summary') {
                    resume.summary += (resume.summary ? ' ' : '') + lines[ri];
                } else if (currentSection === 'skills') {
                    resume.skills += (resume.skills ? ', ' : '') + lines[ri];
                } else if (currentSection === 'education') {
                    resume.education += (resume.education ? '\n' : '') + lines[ri];
                } else if (currentSection === 'certifications') {
                    resume.certifications += (resume.certifications ? '\n' : '') + lines[ri];
                } else if (currentSection === 'projects') {
                    var projectLine = lines[ri].replace(/^[\u2022\u2023\u2043\uF0B7\-\u2013]\s*/, '');
                    if (projectLine.length > 3) resume.projects.push(projectLine);
                } else if (currentSection === 'experience') {
                    if (lines[ri].match(/^[A-Za-z ]{3,} at /) || (lines[ri].length < 60 && lines[ri].match(/^[A-Z]/))) {
                        if (currentExp) {
                            resume.experience.push(Object.assign({}, currentExp, { bullets: expBullets }));
                        }
                        var parts3 = lines[ri].split(' at ');
                        resume.experience.push({
                            title: parts3[0].trim(),
                            company: parts3[1] ? parts3[1].trim() : '',
                            location: '',
                            dates: '',
                            bullets: []
                        });
                        currentExp = null;
                        expBullets = [];
                    } else if (lines[ri].startsWith('\u2022') || lines[ri].startsWith('-') || lines[ri].startsWith(
                            '\u2013') || lines[ri].startsWith('\uF0B7')) {
                        expBullets.push(lines[ri].replace(/^[\u2022\u2023\u2043\uF0B7\-\u2013]\s*/, ''));
                    } else if (lines[ri].length > 3 && currentExp) {
                        expBullets.push(lines[ri]);
                    }
                }
            }
        }
        if (currentExp) {
            resume.experience.push(Object.assign({}, currentExp, { bullets: expBullets }));
        }
        resume.skills = resume.skills.replace(/,\s*,/g, ',').replace(/^[, ]+/, '').replace(/[, ]+$/, '');
        if (!resume.skills) {
            var toolsMatch2 = text.match(/TOOLS & PLATFORMS([\s\S]*?)(?=\n##|\n$)/);
            if (toolsMatch2) {
                resume.skills = toolsMatch2[1].replace(/\n/g, ', ').replace(/,\s*,/g, ',').trim();
            }
        }
        if (!resume.summary && resume.experience.length > 0) {
            var firstExp = resume.experience[0];
            resume.summary = 'Experienced ' + (firstExp.title || 'professional') + ' with a background in ' + (resume
                .skills || 'technology') + '.';
        }
        return resume;
    }

    // ─── File extraction (unchanged) ──────────────────────────
    async function extractFileText(file) {
        var ext = file.name.split('.').pop().toLowerCase();
        var rawText = '';
        try {
            if (ext === 'pdf') rawText = await extractPDFText(file);
            else if (ext === 'docx') rawText = await extractDOCXText(file);
            else if (['jpg', 'jpeg', 'png'].indexOf(ext) !== -1) rawText = await extractImageText(file);
            else if (ext === 'txt') rawText = await file.text();
            else throw new Error('Unsupported file format');
        } catch (e) {
            log('Extraction error: ' + e.message, 'error');
            try { rawText = await file.text(); } catch (_) { rawText = ''; }
        }
        return rawText;
    }

    function extractPDFText(file) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = async function(e) {
                try {
                    var typedArray = new Uint8Array(e.target.result);
                    var pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;
                    var fullText = '';
                    for (var pi = 1; pi <= pdf.numPages; pi++) {
                        var page = await pdf.getPage(pi);
                        var content = await page.getTextContent();
                        var strings = content.items.map(function(item) { return item.str; });
                        fullText += strings.join(' ') + '\n';
                    }
                    resolve(fullText);
                } catch (err) { reject(err); }
            };
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }

    function extractDOCXText(file) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = async function(e) {
                try {
                    var arrayBuffer = e.target.result;
                    var result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
                    resolve(result.value);
                } catch (err) { reject(err); }
            };
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }

    function extractImageText(file) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = async function(e) {
                try {
                    var imageData = e.target.result;
                    var recog = await Tesseract.recognize(imageData, 'eng');
                    resolve(recog.data.text);
                } catch (err) { reject(err); }
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    async function loadResume(file) {
        resumeFileName.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Parsing ' + escapeText(file.name) +
            '...';
        var rawText = '';
        try {
            rawText = await extractFileText(file);
        } catch (e) {
            log('File extraction failed: ' + e.message, 'error');
            resumeFileName.textContent = 'Error: ' + e.message;
            return;
        }
        if (!rawText || rawText.length < 50) {
            log('Could not extract meaningful text from the file.', 'warn');
            resumeFileName.innerHTML =
                '<i class="fas fa-exclamation-triangle"></i> Low text content. Try another file.';
            return;
        }
        state.resumeText = rawText;
        state.hasResume = true;
        resumeFileName.innerHTML = '<i class="fas fa-check-circle" style="color:#55efc4;"></i> ' + escapeText(file
            .name) + ' (' + rawText.length + ' chars)';
        log('Extracted ' + rawText.length + ' chars from ' + file.name, 'success');
        var parsed = null;
        try {
            parsed = await parseResumeWithAI(rawText);
            if (parsed) log('AI parser succeeded.', 'success');
        } catch (e) { log('AI parser failed: ' + e.message, 'warn'); }
        if (!parsed) {
            try {
                parsed = enhancedResumeParser(rawText);
                if (parsed && parsed.personalInfo && parsed.personalInfo.fullName) {
                    log('Enhanced parser succeeded.', 'success');
                } else { parsed = null; }
            } catch (e) { log('Enhanced parser error: ' + e.message, 'warn'); }
        }
        if (!parsed) {
            log('Using fallback simple parser.', 'info');
            parsed = parseResumeSimple(rawText);
        }
        if (parsed) {
            state.resumeStructured = parsed;
            renderResumePreview(parsed);
            fillFormFields(parsed);
            log('Resume parsed and fields filled.', 'success');
        } else {
            log('Failed to parse resume.', 'error');
            return;
        }
        if (!state.engine) { if (!initRAGina()) return; }
        var sections = { 'resume': { bodyText: rawText } };
        try {
            state.engine.buildIndex(sections, 200);
            log('RAGina index built.', 'success');
            updateGenerateButton();
        } catch (e) { log('Index error: ' + e.message, 'error'); }
    }

    // ─── Resume preview rendering (unchanged) ──────────────────
    function fillFormFields(structured) {
        var fields = state._resumePreviewFields;
        if (!fields) {
            log('Form fields not initialized.', 'warn');
            return;
        }
        var pi = structured.personalInfo || {};
        if (fields.fullName) fields.fullName.value = pi.fullName || '';
        if (fields.email) fields.email.value = pi.email || '';
        if (fields.phone) fields.phone.value = pi.phone || '';
        if (fields.location) fields.location.value = pi.location || '';
        if (fields.linkedin) fields.linkedin.value = pi.linkedin || '';
        if (fields.github) fields.github.value = pi.github || '';
        if (fields.summary) fields.summary.value = structured.summary || '';
        if (fields.skills) fields.skills.value = structured.skills || '';
        if (fields.education) fields.education.value = structured.education || '';
        if (fields.certifications) fields.certifications.value = structured.certifications || '';
        if (fields.projects) fields.projects.value = (structured.projects || []).join('\n') || '';
        var expContainer = document.getElementById('resume-experience-container');
        if (expContainer) {
            var items = expContainer.querySelectorAll('.field-group');
            var experiences = structured.experience || [];
            if (items.length === 0 && experiences.length > 0) {
                renderResumePreview(structured);
                state._resumePreviewFields = {
                    fullName: document.getElementById('resume-fullname'),
                    email: document.getElementById('resume-email'),
                    phone: document.getElementById('resume-phone'),
                    location: document.getElementById('resume-location'),
                    linkedin: document.getElementById('resume-linkedin'),
                    github: document.getElementById('resume-github'),
                    summary: document.getElementById('resume-summary'),
                    skills: document.getElementById('resume-skills'),
                    education: document.getElementById('resume-education'),
                    certifications: document.getElementById('resume-certifications'),
                    projects: document.getElementById('resume-projects'),
                };
                fillFormFields(structured);
                return;
            }
            items.forEach(function(item, idx) {
                var exp = experiences[idx] || {};
                var title = item.querySelector('#resume-exp-title-' + idx);
                var company = item.querySelector('#resume-exp-company-' + idx);
                var location = item.querySelector('#resume-exp-location-' + idx);
                var dates = item.querySelector('#resume-exp-dates-' + idx);
                var bullets = item.querySelector('#resume-exp-bullets-' + idx);
                if (title) title.value = exp.title || '';
                if (company) company.value = exp.company || '';
                if (location) location.value = exp.location || '';
                if (dates) dates.value = exp.dates || '';
                if (bullets) bullets.value = (exp.bullets || []).join('\n') || '';
            });
        }
    }

    function renderResumePreview(structured) {
        if (!structured) { log('Structured resume is null.', 'warn'); return; }
        resumePreviewContainer.style.display = 'block';
        var html = '';
        var pi = structured.personalInfo || {};
        html += '<div class="resume-preview-card">';
        html += '<div class="card-label"><i class="fas fa-user"></i> Personal Information</div>';
        html += '<div class="field-group"><label>Full Name</label><input type="text" id="resume-fullname" value="' +
            escapeText(pi.fullName || '') + '" /></div>';
        html += '<div class="field-group"><label>Email</label><input type="email" id="resume-email" value="' +
            escapeText(pi.email || '') + '" /></div>';
        html += '<div class="field-group"><label>Phone</label><input type="text" id="resume-phone" value="' +
            escapeText(pi.phone || '') + '" /></div>';
        html += '<div class="field-group"><label>Location</label><input type="text" id="resume-location" value="' +
            escapeText(pi.location || '') + '" /></div>';
        html += '<div class="field-group"><label>LinkedIn</label><input type="text" id="resume-linkedin" value="' +
            escapeText(pi.linkedin || '') + '" /></div>';
        html += '<div class="field-group"><label>GitHub</label><input type="text" id="resume-github" value="' +
            escapeText(pi.github || '') + '" /></div>';
        html += '</div>';
        html += '<div class="resume-preview-card"><div class="card-label"><i class="fas fa-align-left"></i> Summary</div>';
        html += '<div class="field-group"><textarea id="resume-summary" rows="4">' + escapeText(structured.summary ||
            '') + '</textarea></div></div>';
        html +=
            '<div class="resume-preview-card full-width"><div class="card-label"><i class="fas fa-code"></i> Skills</div>';
        html += '<div class="field-group"><textarea id="resume-skills" rows="2">' + escapeText(structured.skills ||
            '') + '</textarea>';
        html +=
            '<div style="font-size:0.7rem; color:#8a9aaa; margin-top:2px;">Comma-separated list</div></div></div>';
        html +=
            '<div class="resume-preview-card full-width"><div class="card-label"><i class="fas fa-briefcase"></i> Experience</div>';
        html += '<div id="resume-experience-container">';
        var exp = structured.experience || [];
        if (exp.length === 0) {
            html +=
                '<div class="field-group"><textarea id="resume-experience-0" rows="3" placeholder="No experience entries found."></textarea></div>';
        } else {
            exp.forEach(function(e, idx) {
                var bullets = e.bullets || [];
                html +=
                    '<div class="field-group" style="border:1px solid #eee; padding:8px; margin-bottom:8px;">';
                html += '<input type="text" id="resume-exp-title-' + idx + '" value="' + escapeText(e
                    .title || '') + '" placeholder="Job Title" />';
                html += '<input type="text" id="resume-exp-company-' + idx + '" value="' + escapeText(e
                    .company || '') + '" placeholder="Company" style="margin-top:4px;" />';
                html += '<input type="text" id="resume-exp-location-' + idx + '" value="' + escapeText(e
                    .location || '') + '" placeholder="Location" style="margin-top:4px;" />';
                html += '<input type="text" id="resume-exp-dates-' + idx + '" value="' + escapeText(e
                    .dates || '') + '" placeholder="Dates (e.g. 2020\u20132023)" style="margin-top:4px;" />';
                html += '<textarea id="resume-exp-bullets-' + idx +
                    '" rows="3" placeholder="Achievements (one per line)" style="margin-top:4px;">' +
                    bullets.map(function(b) { return escapeText(b); }).join('\n') + '</textarea>';
                html += '</div>';
            });
        }
        html += '</div></div>';
        html += '<div class="resume-preview-card"><div class="card-label"><i class="fas fa-graduation-cap"></i> Education</div>';
        html += '<div class="field-group"><textarea id="resume-education" rows="3">' + escapeText(structured
            .education || '') + '</textarea></div></div>';
        html +=
            '<div class="resume-preview-card"><div class="card-label"><i class="fas fa-certificate"></i> Certifications</div>';
        html += '<div class="field-group"><textarea id="resume-certifications" rows="3">' + escapeText(structured
            .certifications || '') + '</textarea></div></div>';
        var projects = structured.projects || [];
        html +=
            '<div class="resume-preview-card full-width"><div class="card-label"><i class="fas fa-folder-open"></i> Projects</div>';
        html += '<div class="field-group"><textarea id="resume-projects" rows="4">' + projects.map(function(p) {
            return escapeText(p);
        }).join('\n') + '</textarea></div></div>';
        resumePreviewGrid.innerHTML = html;
        state._resumePreviewFields = {
            fullName: document.getElementById('resume-fullname'),
            email: document.getElementById('resume-email'),
            phone: document.getElementById('resume-phone'),
            location: document.getElementById('resume-location'),
            linkedin: document.getElementById('resume-linkedin'),
            github: document.getElementById('resume-github'),
            summary: document.getElementById('resume-summary'),
            skills: document.getElementById('resume-skills'),
            education: document.getElementById('resume-education'),
            certifications: document.getElementById('resume-certifications'),
            projects: document.getElementById('resume-projects'),
        };
        fetchPersonalInfoBtn.disabled = false;
    }

    // ─── Save / load / clear resume (unchanged) ──────────────
    function saveResumeData() {
        var fields = state._resumePreviewFields;
        if (!fields) { log('No resume data to save.', 'warn'); return; }
        var data = {
            personalInfo: {
                fullName: fields.fullName ? fields.fullName.value : '',
                email: fields.email ? fields.email.value : '',
                phone: fields.phone ? fields.phone.value : '',
                location: fields.location ? fields.location.value : '',
                linkedin: fields.linkedin ? fields.linkedin.value : '',
                github: fields.github ? fields.github.value : '',
            },
            summary: fields.summary ? fields.summary.value : '',
            skills: fields.skills ? fields.skills.value : '',
            education: fields.education ? fields.education.value : '',
            certifications: fields.certifications ? fields.certifications.value : '',
            projects: fields.projects ? fields.projects.value.split('\n').filter(function(l) { return l.trim(); }) :
                [],
            experience: []
        };
        var expContainer = document.getElementById('resume-experience-container');
        if (expContainer) {
            var items = expContainer.querySelectorAll('.field-group');
            items.forEach(function(item, idx) {
                var title = item.querySelector('#resume-exp-title-' + idx);
                var company = item.querySelector('#resume-exp-company-' + idx);
                var location = item.querySelector('#resume-exp-location-' + idx);
                var dates = item.querySelector('#resume-exp-dates-' + idx);
                var bullets = item.querySelector('#resume-exp-bullets-' + idx);
                if (title || company) {
                    data.experience.push({
                        title: title ? title.value : '',
                        company: company ? company.value : '',
                        location: location ? location.value : '',
                        dates: dates ? dates.value : '',
                        bullets: bullets ? bullets.value.split('\n').filter(function(l) { return l.trim(); }) :
                            []
                    });
                }
            });
        }
        try {
            localStorage.setItem('curvina_resume_data', JSON.stringify(data));
            log('Resume data saved to localStorage!', 'success');
            saveResumeBtn.innerHTML = '<i class="fas fa-check"></i> Saved!';
            setTimeout(function() { saveResumeBtn.innerHTML = '<i class="fas fa-save"></i> Save'; }, 1500);
        } catch (e) { log('Error saving resume data: ' + e.message, 'error'); }
    }

    function clearResumeForm() {
        var fields = state._resumePreviewFields;
        if (!fields) { log('No resume fields to clear.', 'warn'); return; }
        if (!confirm('Clear all resume form fields?')) return;
        if (fields.fullName) fields.fullName.value = '';
        if (fields.email) fields.email.value = '';
        if (fields.phone) fields.phone.value = '';
        if (fields.location) fields.location.value = '';
        if (fields.linkedin) fields.linkedin.value = '';
        if (fields.github) fields.github.value = '';
        if (fields.summary) fields.summary.value = '';
        if (fields.skills) fields.skills.value = '';
        if (fields.education) fields.education.value = '';
        if (fields.certifications) fields.certifications.value = '';
        if (fields.projects) fields.projects.value = '';
        var expContainer = document.getElementById('resume-experience-container');
        if (expContainer) {
            var items = expContainer.querySelectorAll('.field-group');
            items.forEach(function(item) {
                var inputs = item.querySelectorAll('input, textarea');
                inputs.forEach(function(input) { input.value = ''; });
            });
        }
        log('Resume form cleared.', 'info');
        clearResumeBtn.innerHTML = '<i class="fas fa-check"></i> Cleared!';
        setTimeout(function() { clearResumeBtn.innerHTML = '<i class="fas fa-trash-alt"></i> Clear'; }, 1500);
    }

    function loadSavedResume() {
        try {
            var saved = localStorage.getItem('curvina_resume_data');
            if (saved) {
                var data = JSON.parse(saved);
                if (data) {
                    state.resumeStructured = data;
                    renderResumePreview(data);
                    fillFormFields(data);
                    log('Saved resume loaded from localStorage.', 'success');
                }
            }
        } catch (e) {}
    }

    function getEditedResumeData() {
        var fields = state._resumePreviewFields || {};
        var structured = {
            personalInfo: {
                fullName: fields.fullName ? fields.fullName.value : '',
                email: fields.email ? fields.email.value : '',
                phone: fields.phone ? fields.phone.value : '',
                location: fields.location ? fields.location.value : '',
                linkedin: fields.linkedin ? fields.linkedin.value : '',
                github: fields.github ? fields.github.value : '',
            },
            summary: fields.summary ? fields.summary.value : '',
            skills: fields.skills ? fields.skills.value : '',
            education: fields.education ? fields.education.value : '',
            certifications: fields.certifications ? fields.certifications.value : '',
            projects: fields.projects ? fields.projects.value.split('\n').filter(function(l) { return l.trim(); }) :
                [],
            experience: []
        };
        var expContainer = document.getElementById('resume-experience-container');
        if (expContainer) {
            var items = expContainer.querySelectorAll('.field-group');
            items.forEach(function(item, idx) {
                var title = item.querySelector('#resume-exp-title-' + idx);
                var company = item.querySelector('#resume-exp-company-' + idx);
                var location = item.querySelector('#resume-exp-location-' + idx);
                var dates = item.querySelector('#resume-exp-dates-' + idx);
                var bullets = item.querySelector('#resume-exp-bullets-' + idx);
                if (title || company) {
                    structured.experience.push({
                        title: title ? title.value : '',
                        company: company ? company.value : '',
                        location: location ? location.value : '',
                        dates: dates ? dates.value : '',
                        bullets: bullets ? bullets.value.split('\n').filter(function(l) { return l.trim(); }) :
                            []
                    });
                }
            });
        }
        return structured;
    }

    async function fetchPersonalInfo() {
        if (!state.resumeText || state.resumeText.length < 50) {
            log('No resume text available. Please upload a resume first.', 'warn');
            return;
        }
        fetchPersonalInfoBtn.disabled = true;
        fetchPersonalInfoBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Parsing with AI...';
        var parsed = null;
        try {
            parsed = await parseResumeWithAI(state.resumeText);
            if (parsed) log('AI parser succeeded.', 'success');
        } catch (e) { log('AI parser failed: ' + e.message, 'warn'); }
        if (!parsed) {
            fetchPersonalInfoBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Using local parser...';
            try {
                parsed = enhancedResumeParser(state.resumeText);
                if (parsed && parsed.personalInfo && parsed.personalInfo.fullName) {
                    log('Enhanced parser succeeded.', 'success');
                } else { parsed = null; }
            } catch (e) { log('Enhanced parser error: ' + e.message, 'warn'); }
        }
        if (!parsed) {
            log('Using fallback simple parser.', 'info');
            parsed = parseResumeSimple(state.resumeText);
        }
        if (parsed) {
            state.resumeStructured = parsed;
            renderResumePreview(parsed);
            fillFormFields(parsed);
            log('Personal info fetched and filled successfully!', 'success');
            fetchPersonalInfoBtn.innerHTML = '<i class="fas fa-check"></i> Fetched!';
            setTimeout(function() {
                fetchPersonalInfoBtn.innerHTML = '<i class="fas fa-magic"></i> Fetch Personal Info';
                fetchPersonalInfoBtn.disabled = false;
            }, 2000);
        } else {
            log('All parsing methods failed.', 'error');
            fetchPersonalInfoBtn.innerHTML = '<i class="fas fa-magic"></i> Fetch Personal Info';
            fetchPersonalInfoBtn.disabled = false;
        }
    }

    function buildResumeTextFromStructured(structured) {
        var text = '';
        var pi = structured.personalInfo || {};
        if (pi.fullName) text += pi.fullName + '\n';
        if (pi.email) text += 'Email: ' + pi.email + '\n';
        if (pi.phone) text += 'Phone: ' + pi.phone + '\n';
        if (pi.location) text += 'Location: ' + pi.location + '\n';
        if (pi.linkedin) text += 'LinkedIn: ' + pi.linkedin + '\n';
        if (pi.github) text += 'GitHub: ' + pi.github + '\n';
        text += '\n';
        if (structured.summary) text += 'SUMMARY\n' + structured.summary + '\n\n';
        if (structured.skills) text += 'SKILLS\n' + structured.skills + '\n\n';
        var exp = structured.experience || [];
        if (exp.length > 0) {
            text += 'EXPERIENCE\n';
            exp.forEach(function(e) {
                text += e.title + (e.company ? ' at ' + e.company : '') + (e.dates ? ' (' + e.dates + ')' :
                    '') + '\n';
                if (e.bullets) {
                    e.bullets.forEach(function(b) { text += '  \u2022 ' + b + '\n'; });
                }
                text += '\n';
            });
        }
        if (structured.education) text += 'EDUCATION\n' + structured.education + '\n\n';
        if (structured.certifications) text += 'CERTIFICATIONS\n' + structured.certifications + '\n\n';
        var projects = structured.projects || [];
        if (projects.length > 0) {
            text += 'PROJECTS\n';
            projects.forEach(function(p) { text += '  \u2022 ' + p + '\n'; });
        }
        return text;
    }

    // ─── Generate content (unchanged) ──────────────────────────
    function updateGenerateButton() {
        var hasJD = state.jobDescription && state.jobDescription.fullDescription;
        var hasEngine = state.engine && state.engine.isReady;
        generateBtn.disabled = !(hasJD && hasEngine && !state.isProcessing);
    }

    async function generateContent() {
        if (state.isProcessing) return;
        if (!state.engine || !state.engine.isReady) {
            log('RAGina engine not ready.', 'error');
            return;
        }
        if (!state.jobDescription || !state.jobDescription.fullDescription) {
            log('No job description.', 'error');
            return;
        }
        var editedResume = getEditedResumeData();
        var resumeText = buildResumeTextFromStructured(editedResume);
        state.isProcessing = true;
        generateBtn.disabled = true;
        setStatus('Processing...', 'loading');
        log('Generating content...', 'info');
        state.sections = { summary: '', skills: '', experience: '', projects: '', education: '', certifications: '' };
        contentContainer.style.display = 'block';
        sectionsContainer.innerHTML = '';
        showLoadingSections();
        var jd = state.jobDescription;
        var fullDesc = jd.fullDescription || '';
        var keywords = state.jobKeywords;
        var hasResume = state.hasResume && resumeText.length > 50;
        modeBadge.textContent = hasResume ? 'Resume + JD' : 'JD Only';
        modeBadge.className = 'badge-mode ' + (hasResume ? 'resume' : 'jd-only');
        try {
            var context = '';
            if (hasResume) {
                var query = fullDesc;
                var topChunks = state.engine.retrieve(query, 8);
                context = topChunks.map(function(chunk, i) {
                    return '[' + (i + 1) + '] ' + chunk.source + ':\n' + chunk.text;
                }).join('\n\n');
                log('Retrieved ' + topChunks.length + ' chunks from resume.', 'info');
            } else {
                context = 'No resume provided. Generate content based solely on the job description.';
                log('No resume uploaded. Generating from JD only.', 'info');
            }
            var sectionPrompts = [{
                key: 'summary',
                label: 'Professional Summary',
                prompt: 'Write a professional summary (4-5 sentences) for a candidate applying to this role.\n\nJOB DESCRIPTION:\n' +
                    fullDesc + '\n\nKEYWORDS: ' + keywords.join(', ') + '\n\n' + (hasResume ?
                    'CANDIDATE RESUME CONTEXT (use this to personalize):\n' + context.slice(0, 800) :
                    'No resume provided. Create a generic but compelling summary for this role.') +
                    '\n\nOutput ONLY the summary text. Do not include any additional commentary, instructions, or formatting.',
                fallbackKeywords: keywords
            }, {
                key: 'skills',
                label: 'Technical Skills',
                prompt: 'List the top technical skills most relevant to this job.\n\nJOB DESCRIPTION KEYWORDS: ' +
                    keywords.join(', ') + '\n\n' + (hasResume ?
                    'CANDIDATE SKILLS (from resume context):\n' + context.slice(0, 400) :
                    'No resume provided. List the most relevant skills for this role based on the job description.'
                    ) +
                    '\n\nOutput ONLY a comma-separated list of skills. Do not include any additional text.',
                fallbackKeywords: keywords
            }, {
                key: 'experience',
                label: 'Professional Experience',
                prompt: (hasResume ?
                    'Rewrite the work experience section to highlight achievements most relevant to this job.' :
                    'Create a sample work experience section for a candidate applying to this role.') +
                    '\n\nJOB DESCRIPTION KEYWORDS: ' + keywords.join(', ') + '\n\n' + (hasResume ?
                    'CANDIDATE EXPERIENCE:\n' + context.slice(0, 1200) :
                    'No resume provided. Create 2-3 generic but relevant experience entries for this role.'
                    ) +
                    '\n\nOutput ONLY the experience entries. Use bullet points (\u2022) for achievements. Do not include any additional commentary.',
                fallbackKeywords: keywords
            }, {
                key: 'projects',
                label: 'Projects',
                prompt: (hasResume ?
                    'List key projects from the candidate\'s resume that demonstrate skills relevant to this role.'
                    :
                    'List sample projects that demonstrate skills relevant to this role.') +
                    '\n\nJOB DESCRIPTION KEYWORDS: ' + keywords.join(', ') + '\n\n' + (hasResume ?
                    'CANDIDATE PROJECTS (from resume context):\n' + context.slice(0, 500) :
                    'No resume provided. Create 2-3 sample projects relevant to this role.') +
                    '\n\nOutput ONLY the project list. Use bullet points (\u2022) for each project. Do not include any additional text.',
                fallbackKeywords: keywords
            }, {
                key: 'education',
                label: 'Education',
                prompt: (hasResume ?
                    'Extract the education information from the candidate\'s resume.' :
                    'Create a sample education section for a candidate applying to this role.') +
                    '\n\nJOB DESCRIPTION KEYWORDS: ' + keywords.join(', ') + '\n\n' + (hasResume ?
                    'CANDIDATE RESUME CONTEXT:\n' + context.slice(0, 300) :
                    'No resume provided. Create a generic but relevant education entry.') +
                    '\n\nOutput ONLY the education details. Do not include any additional text.',
                fallbackKeywords: keywords
            }, {
                key: 'certifications',
                label: 'Certifications',
                prompt: (hasResume ?
                    'List certifications from the candidate\'s resume that are relevant to this job.' :
                    'List certifications that would be relevant for this role.') +
                    '\n\nJOB DESCRIPTION KEYWORDS: ' + keywords.join(', ') + '\n\n' + (hasResume ?
                    'CANDIDATE CERTIFICATIONS (from resume context):\n' + context.slice(0, 300) :
                    'No resume provided. List relevant certifications for this role.') +
                    '\n\nOutput ONLY a bulleted list of certifications. Do not include any additional text.',
                fallbackKeywords: keywords
            }];
            var sectionIndex = 0;
            for (var si = 0; si < sectionPrompts.length; si++) {
                var section = sectionPrompts[si];
                sectionIndex++;
                updateSectionLoading(section.key, true);
                statusText.textContent = 'Generating ' + sectionIndex + '/' + sectionPrompts.length + ': ' + section
                    .label + '...';
                log('(' + sectionIndex + '/' + sectionPrompts.length + ') Generating ' + section.label + '...',
                    'info');
                try {
                    var result = await window.askLLM(section.prompt, 'openai', section.fallbackKeywords);
                    if (!result || result.startsWith('\u26A0\uFE0F Error:') || result.trim().length < 5) {
                        throw new Error(result || 'Empty response');
                    }
                    var cleaned = cleanText(result);
                    if (cleaned && cleaned.length > 5) {
                        state.sections[section.key] = cleaned;
                        updateSectionContent(section.key, cleaned);
                        log(section.label + ' generated.', 'success');
                    } else {
                        throw new Error('Clean content empty');
                    }
                } catch (e) {
                    log(section.label + ' error: ' + e.message, 'error');
                    var fallback = generateFallback(section.prompt, section.fallbackKeywords);
                    state.sections[section.key] = fallback;
                    updateSectionContent(section.key, fallback);
                } finally {
                    updateSectionLoading(section.key, false);
                }
            }
            addCurifyButtons();
            log('All sections processed!', 'success');
            setStatus('Success', 'success');
            statusText.textContent = 'Content generated successfully! Use "Curify" to improve sections.';
            updateGenerateButton();
            renderAtsPreview();
            atsPreviewContainer.classList.add('active');
        } catch (e) {
            log('Error: ' + e.message, 'error');
            setStatus('Error', 'error');
            statusText.textContent = 'Error: ' + e.message;
        } finally {
            state.isProcessing = false;
            generateBtn.disabled = false;
            updateGenerateButton();
        }
    }

    // ─── Curify section (unchanged) ──────────────────────────
    async function curifySection(sectionKey) {
        var card = document.getElementById('section-' + sectionKey);
        if (!card) return;
        var contentEl = document.getElementById('content-' + sectionKey);
        if (!contentEl) return;
        var currentContent = state.sections[sectionKey] || '';
        if (!currentContent || currentContent.length < 10) {
            log('No content to curify for ' + sectionKey + '.', 'warn');
            return;
        }
        var actions = card.querySelector('.section-actions');
        var promptInput = actions ? actions.querySelector('.custom-prompt-input') : null;
        var customPrompt = promptInput ? promptInput.value.trim() : '';
        if (!customPrompt) {
            log('Please enter a custom prompt before clicking Curify.', 'warn');
            promptInput.focus();
            promptInput.classList.add('active');
            return;
        }
        var btn = card.querySelector('.btn-curify');
        if (btn) {
            btn.disabled = true;
            btn.classList.add('loading');
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Curifying...';
        }
        var jd = state.jobDescription;
        var fullDesc = jd.fullDescription || '';
        var keywords = state.jobKeywords.join(', ');
        var sectionLabels = {
            summary: 'Professional Summary',
            skills: 'Technical Skills',
            experience: 'Professional Experience',
            projects: 'Projects',
            education: 'Education',
            certifications: 'Certifications'
        };
        var label = sectionLabels[sectionKey] || sectionKey;
        log('Curifying ' + label + ' with prompt: "' + customPrompt + '"...', 'info');
        try {
            var prompt = 'You are an expert resume writer. Rewrite the following ' + label +
                ' section based on the user\'s custom instruction.\n\nJOB DESCRIPTION:\n' + fullDesc +
                '\n\nKEYWORDS: ' + keywords + '\n\nCURRENT CONTENT:\n' + currentContent +
                '\n\nUSER\'S CUSTOM INSTRUCTION:\n' + customPrompt +
                '\n\nRequirements:\n- Output the COMPLETE rewritten section, replacing the old content entirely.\n- Follow the user\'s custom instruction carefully.\n- Incorporate keywords from the job description naturally.\n- Maintain the same format and structure (bullets, paragraphs).\n- Output ONLY the rewritten section text, no additional commentary.';
            var result = await window.askLLM(prompt, 'openai', state.jobKeywords);
            if (!result || result.startsWith('\u26A0\uFE0F Error:') || result.trim().length < 5) {
                throw new Error(result || 'Empty response');
            }
            var cleaned = cleanText(result);
            if (cleaned && cleaned.length > 5) {
                state.sections[sectionKey] = cleaned;
                updateSectionContent(sectionKey, cleaned);
                log(label + ' curified successfully.', 'success');
                if (promptInput) {
                    promptInput.value = '';
                    promptInput.classList.remove('active');
                }
                renderAtsPreview();
            } else {
                throw new Error('Clean content empty');
            }
        } catch (e) {
            log('Curify error for ' + label + ': ' + e.message, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.classList.remove('loading');
                btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Curify';
            }
        }
    }

    function updateSectionContent(key, content) {
        var el = document.getElementById('content-' + key);
        if (el) el.innerHTML = '<pre>' + escapeText(content) + '</pre>';
    }

    function updateSectionLoading(key, isLoading) {
        var el = document.getElementById('content-' + key);
        if (el && isLoading) el.innerHTML = '<span class="loading-dots">Generating...</span>';
    }

    function showLoadingSections() {
        var configs = [
            { key: 'summary', label: 'Professional Summary', icon: 'fa-user-tie' },
            { key: 'skills', label: 'Technical Skills', icon: 'fa-code' },
            { key: 'experience', label: 'Professional Experience', icon: 'fa-briefcase' },
            { key: 'projects', label: 'Projects', icon: 'fa-folder-open' },
            { key: 'education', label: 'Education', icon: 'fa-graduation-cap' },
            { key: 'certifications', label: 'Certifications', icon: 'fa-certificate' },
        ];
        var html = '';
        for (var c = 0; c < configs.length; c++) {
            html += '<div class="section-card full-width" id="section-' + configs[c].key + '">';
            html += '<div class="section-label"><span><i class="fas ' + configs[c].icon + '"></i> ' + configs[c]
                .label + '</span></div>';
            html += '<div class="section-content" id="content-' + configs[c].key +
                '"><span class="loading-dots">Generating...</span></div>';
            html += '</div>';
        }
        sectionsContainer.innerHTML = html;
    }

    function addCurifyButtons() {
        var sectionKeys = ['summary', 'skills', 'experience', 'projects', 'education', 'certifications'];
        var sectionLabels = {
            summary: 'Professional Summary',
            skills: 'Technical Skills',
            experience: 'Professional Experience',
            projects: 'Projects',
            education: 'Education',
            certifications: 'Certifications'
        };
        for (var ck = 0; ck < sectionKeys.length; ck++) {
            var key = sectionKeys[ck];
            var card = document.getElementById('section-' + key);
            if (!card) continue;
            var actions = card.querySelector('.section-actions');
            if (!actions) {
                actions = document.createElement('div');
                actions.className = 'section-actions';
                card.appendChild(actions);
            }
            actions.innerHTML = '';
            var curifyBtn = document.createElement('button');
            curifyBtn.className = 'btn btn-curify';
            curifyBtn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Curify';
            curifyBtn.dataset.section = key;
            curifyBtn.addEventListener('click', (function(k) { return function() { curifySection(k); }; })(key));
            actions.appendChild(curifyBtn);
            var copyBtn = document.createElement('button');
            copyBtn.className = 'btn btn-secondary';
            copyBtn.innerHTML = '<i class="fas fa-copy"></i> Copy';
            copyBtn.addEventListener('click', (function(k) { return function() {
                var text = state.sections[k] || '';
                navigator.clipboard.writeText(text).then(function() {
                    copyBtn.innerHTML = '<i class="fas fa-check"></i> Copied';
                    setTimeout(function() { copyBtn.innerHTML =
                        '<i class="fas fa-copy"></i> Copy'; }, 1500);
                }).catch(function() {
                    log('Clipboard copy failed. Select and copy manually.', 'warn');
                });
            }; })(key));
            actions.appendChild(copyBtn);
            var promptToggle = document.createElement('button');
            promptToggle.className = 'prompt-toggle';
            promptToggle.innerHTML = '<i class="fas fa-pen"></i> Custom Prompt';
            promptToggle.addEventListener('click', function() {
                var input = actions.querySelector('.custom-prompt-input');
                if (input) {
                    input.classList.toggle('active');
                    if (input.classList.contains('active')) input.focus();
                }
            });
            actions.appendChild(promptToggle);
            var promptInput = document.createElement('input');
            promptInput.type = 'text';
            promptInput.className = 'custom-prompt-input';
            promptInput.placeholder = 'e.g., Focus on leadership, Add more technical details...';
            promptInput.dataset.section = key;
            actions.appendChild(promptInput);
        }
    }

    // ─── Utility functions (unchanged) ────────────────────────
    function assembleFullResumeText() {
        var labels = {
            summary: 'PROFESSIONAL SUMMARY',
            skills: 'TECHNICAL SKILLS',
            experience: 'PROFESSIONAL EXPERIENCE',
            projects: 'PROJECTS',
            education: 'EDUCATION',
            certifications: 'CERTIFICATIONS'
        };
        var order = ['summary', 'skills', 'experience', 'projects', 'education', 'certifications'];
        var out = [];
        for (var o = 0; o < order.length; o++) {
            var content = (state.sections[order[o]] || '').trim();
            if (!content) continue;
            out.push(labels[order[o]] + '\n' + '\u2500'.repeat(labels[order[o]].length) + '\n' + content);
        }
        return out.join('\n\n');
    }

    function downloadResumeJSON() {
        var data = getEditedResumeData();
        if (!data) { log('No resume data to download.', 'warn'); return; }
        var json = JSON.stringify(data, null, 2);
        var blob = new Blob([json], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'curvina_resume_' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        log('Resume JSON downloaded.', 'success');
    }

    // ─── ATS HTML builder (unchanged) ────────────────────────
    function buildAtsHtml() {
        var edited = getEditedResumeData();
        var pi = edited.personalInfo || {};
        var jobTitle = (state.jobDescription && state.jobDescription.job) ? state.jobDescription.job.title : '';
        var company = (state.jobDescription && state.jobDescription.job) ? state.jobDescription.job.company : '';

        var html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n';
        html += '<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n';
        html += '<title>' + escapeText(pi.fullName || 'Resume') + ' - Resume</title>\n';
        html += '<style>\n';
        html += '  * { margin: 0; padding: 0; box-sizing: border-box; }\n';
        html +=
            '  body { font-family: Arial, "Helvetica Neue", Helvetica, sans-serif; font-size: 11pt; line-height: 1.5; color: #1a1a1a; background: #fff; padding: 40px; max-width: 8.5in; margin: 0 auto; }\n';
        html += '  h1 { font-size: 20pt; font-weight: bold; color: #1a1a1a; margin-bottom: 4px; letter-spacing: 0.5px; }\n';
        html += '  .contact-line { font-size: 10pt; color: #333; margin-bottom: 16px; }\n';
        html += '  .contact-line a { color: #1a1a1a; text-decoration: none; }\n';
        html +=
            '  h2 { font-size: 12pt; font-weight: bold; color: #1a1a1a; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #1a1a1a; padding-bottom: 3px; margin-top: 16px; margin-bottom: 8px; }\n';
        html += '  p { margin-bottom: 8px; text-align: justify; }\n';
        html += '  ul { margin-left: 20px; margin-bottom: 8px; }\n';
        html += '  li { margin-bottom: 3px; }\n';
        html +=
            '  .exp-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 2px; }\n';
        html += '  .exp-title { font-weight: bold; font-size: 11pt; }\n';
        html += '  .exp-date { font-size: 10pt; color: #444; font-style: italic; }\n';
        html += '  .exp-company { font-size: 10pt; color: #333; margin-bottom: 4px; }\n';
        html += '  .skills-list { line-height: 1.8; }\n';
        html += '  .section { margin-bottom: 12px; }\n';
        html += '  @media print { body { padding: 0; } .no-print { display: none; } }\n';
        html += '</style>\n</head>\n<body>\n';

        // Header
        html += '<h1>' + escapeText(pi.fullName || 'Your Name') + '</h1>\n';
        var contacts = [];
        if (pi.email) contacts.push(escapeText(pi.email));
        if (pi.phone) contacts.push(escapeText(pi.phone));
        if (pi.location) contacts.push(escapeText(pi.location));
        if (pi.linkedin) contacts.push('<a href="https://' + escapeText(pi.linkedin) + '">' + escapeText(pi
            .linkedin) + '</a>');
        if (pi.github) contacts.push('<a href="https://' + escapeText(pi.github) + '">' + escapeText(pi.github) +
            '</a>');
        if (contacts.length) {
            html += '<div class="contact-line">' + contacts.join(' | ') + '</div>\n';
        }

        // Professional Summary
        if (state.sections.summary) {
            html += '<div class="section">\n<h2>Professional Summary</h2>\n';
            html += '<p>' + escapeText(state.sections.summary).replace(/\n/g, '</p>\n<p>') + '</p>\n';
            html += '</div>\n';
        }

        // Technical Skills
        if (state.sections.skills) {
            html += '<div class="section">\n<h2>Technical Skills</h2>\n';
            html += '<p class="skills-list">' + escapeText(state.sections.skills) + '</p>\n';
            html += '</div>\n';
        }

        // Professional Experience
        if (state.sections.experience) {
            html += '<div class="section">\n<h2>Professional Experience</h2>\n';
            var expLines = state.sections.experience.split('\n');
            var inExp = false;
            for (var el = 0; el < expLines.length; el++) {
                var line = expLines[el].trim();
                if (!line) continue;
                if (line.match(/^[\u2022\-\u2013]\s*/)) {
                    if (!inExp) { html += '<ul>\n';
                        inExp = true; }
                    html += '<li>' + escapeText(line.replace(/^[\u2022\-\u2013]\s*/, '')) + '</li>\n';
                } else {
                    if (inExp) { html += '</ul>\n';
                        inExp = false; }
                    var titleMatch = line.match(/^(.+?)\s+at\s+(.+?)\s*\(([^)]+)\)\s*$/);
                    if (titleMatch) {
                        html += '<div class="exp-header">\n';
                        html += '<span class="exp-title">' + escapeText(titleMatch[1].trim()) + '</span>\n';
                        html += '<span class="exp-date">' + escapeText(titleMatch[3].trim()) + '</span>\n';
                        html += '</div>\n';
                        html += '<div class="exp-company">' + escapeText(titleMatch[2].trim()) + '</div>\n';
                    } else {
                        html += '<p>' + escapeText(line) + '</p>\n';
                    }
                }
            }
            if (inExp) html += '</ul>\n';
            html += '</div>\n';
        }

        // Projects
        if (state.sections.projects) {
            html += '<div class="section">\n<h2>Projects</h2>\n';
            var projLines = state.sections.projects.split('\n');
            html += '<ul>\n';
            for (var pl = 0; pl < projLines.length; pl++) {
                var pline = projLines[pl].trim();
                if (!pline) continue;
                html += '<li>' + escapeText(pline.replace(/^[\u2022\-\u2013]\s*/, '')) + '</li>\n';
            }
            html += '</ul>\n</div>\n';
        }

        // Education
        if (state.sections.education) {
            html += '<div class="section">\n<h2>Education</h2>\n';
            var eduLines = state.sections.education.split('\n');
            for (var edl = 0; edl < eduLines.length; edl++) {
                var eline = eduLines[edl].trim();
                if (!eline) continue;
                html += '<p>' + escapeText(eline) + '</p>\n';
            }
            html += '</div>\n';
        }

        // Certifications
        if (state.sections.certifications) {
            html += '<div class="section">\n<h2>Certifications</h2>\n';
            var certLines = state.sections.certifications.split('\n');
            html += '<ul>\n';
            for (var cl = 0; cl < certLines.length; cl++) {
                var cline = certLines[cl].trim();
                if (!cline) continue;
                html += '<li>' + escapeText(cline.replace(/^[\u2022\-\u2013]\s*/, '')) + '</li>\n';
            }
            html += '</ul>\n</div>\n';
        }

        if (jobTitle || company) {
            html +=
                '<div class="section no-print" style="margin-top:24px; padding-top:12px; border-top:1px solid #ddd; font-size:9pt; color:#888;">\n';
            html += '<p><em>This resume has been tailored for: ' + escapeText(jobTitle || '') + (company ? ' at ' +
                escapeText(company) : '') + '</em></p>\n';
            html += '</div>\n';
        }

        html += '</body>\n</html>';
        return html;
    }

    function renderAtsPreview() {
        var html = buildAtsHtml();
        var blob = new Blob([html], { type: 'text/html' });
        var url = URL.createObjectURL(blob);
        atsIframe.src = url;
    }

    function downloadAtsHtml() {
        var html = buildAtsHtml();
        var jobTitle = (state.jobDescription && state.jobDescription.job) ? state.jobDescription.job.title.replace(
            /[^A-Za-z0-9]+/g, '_').slice(0, 40) : 'resume';
        var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'CurVina_' + jobTitle + '.html';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        log('ATS-friendly HTML resume downloaded.', 'success');
    }

    function printAtsPdf() {
        var html = buildAtsHtml();
        var printWindow = window.open('', '_blank');
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(function() {
            printWindow.print();
        }, 500);
    }

    // ─── Clear all ────────────────────────────────────────────
    function clearAll() {
        state.jobDescription = null;
        state.jobKeywords = [];
        state.resumeText = '';
        state.hasResume = false;
        state.resumeStructured = null;
        state.sections = { summary: '', skills: '', experience: '', projects: '', education: '', certifications: '' };
        state.isProcessing = false;
        jdContainer.innerHTML =
            '<div style="color:#8a9aaa; font-style:italic; padding:20px 0; text-align:center;">No job description loaded yet.</div>';
        contentContainer.style.display = 'none';
        sectionsContainer.innerHTML = '';
        resumePreviewContainer.style.display = 'none';
        resumePreviewGrid.innerHTML = '';
        resumeFileName.textContent = 'No file selected';
        urlInput.value = '';
        resumeFileInput.value = '';
        retryText.textContent = '';
        setStatus('Ready', '');
        statusText.textContent = 'Cleared.';
        generateBtn.disabled = true;
        pasteJdRow.style.display = 'none';
        pasteJdTextarea.value = '';
        fetchFailSuggestion.style.display = 'none';
        atsPreviewContainer.classList.remove('active');
        atsIframe.src = 'about:blank';
        debugVisible = false;
        debugToggleBtn.innerHTML = '<i class="fas fa-bug"></i> Show Debug';
        debugContainer.innerHTML = '';
        log('Cleared.', 'info');
    }

    // ─── Debug ─────────────────────────────────────────────────
    var debugVisible = false;

    function toggleDebug() {
        debugVisible = !debugVisible;
        debugToggleBtn.innerHTML = debugVisible ?
            '<i class="fas fa-bug"></i> Hide Debug' :
            '<i class="fas fa-bug"></i> Show Debug';
        var container = debugContainer;
        if (debugVisible) {
            var raw = window.__lastRawLLMResponse || 'No raw response yet.';
            container.innerHTML =
                '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;"><span style="font-weight:600;">Raw LLM Response (first 2000 chars)</span><button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText(window.__lastRawLLMResponse || \'\').then(function(){alert(\'Copied!\')})">Copy</button></div><div style="background:#f5f0ea; padding:12px; font-family:\'Courier New\', monospace; font-size:0.8rem; white-space:pre-wrap; word-break:break-all; max-height:400px; overflow-y:auto;">' +
                escapeText(raw.slice(0, 2000)) + (raw.length > 2000 ? '... (truncated)' : '') +
                '</div>';
        } else {
            container.innerHTML = '';
        }
    }
    debugToggleBtn.addEventListener('click', toggleDebug);

    // ─── Event bindings (unchanged) ──────────────────────────
    fetchBtn.addEventListener('click', async function() {
        var url = urlInput.value.trim();
        if (!url) { log('Enter a URL.', 'warn'); return; }
        fetchFailSuggestion.style.display = 'none';
        fetchBtn.disabled = true;
        fetchBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Fetching...';
        try {
            await fetchWithJobScraper(url);
        } finally {
            fetchBtn.disabled = false;
            fetchBtn.innerHTML = '<i class="fas fa-cloud-download-alt"></i> Fetch JD';
        }
    });

    urlInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') fetchBtn.click();
    });

    resumeDrop.addEventListener('click', function() { resumeFileInput.click(); });
    resumeFileInput.addEventListener('change', function(e) {
        var file = e.target.files[0];
        if (!file) return;
        loadResume(file);
        e.target.value = '';
    });
    resumeDrop.addEventListener('dragover', function(e) {
        e.preventDefault();
        this.style.borderColor = '#c9a84c';
        this.style.background = 'rgba(201,168,76,0.05)';
    });
    resumeDrop.addEventListener('dragleave', function(e) {
        e.preventDefault();
        this.style.borderColor = 'rgba(201,168,76,0.2)';
        this.style.background = 'rgba(255,255,255,0.3)';
    });
    resumeDrop.addEventListener('drop', function(e) {
        e.preventDefault();
        this.style.borderColor = 'rgba(201,168,76,0.2)';
        this.style.background = 'rgba(255,255,255,0.3)';
        var file = e.dataTransfer.files[0];
        if (file) loadResume(file);
    });

    toggleResumePreviewBtn.addEventListener('click', function() {
        var grid = resumePreviewGrid;
        if (grid.style.display === 'none') {
            grid.style.display = 'grid';
            toggleResumePreviewBtn.innerHTML = '<i class="fas fa-eye"></i> Hide';
        } else {
            grid.style.display = 'none';
            toggleResumePreviewBtn.innerHTML = '<i class="fas fa-eye"></i> Show';
        }
    });

    toggleAtsPreviewBtn.addEventListener('click', function() {
        atsPreviewContainer.classList.toggle('active');
        var isActive = atsPreviewContainer.classList.contains('active');
        toggleAtsPreviewBtn.innerHTML = isActive ? '<i class="fas fa-eye-slash"></i> Hide' :
            '<i class="fas fa-eye"></i> Show';
    });

    fetchPersonalInfoBtn.addEventListener('click', fetchPersonalInfo);
    saveResumeBtn.addEventListener('click', saveResumeData);
    clearResumeBtn.addEventListener('click', clearResumeForm);
    downloadJsonBtn.addEventListener('click', downloadResumeJSON);

    copyAllBtn.addEventListener('click', function() {
        var text = assembleFullResumeText();
        if (!text) { log('Nothing to copy yet.', 'warn'); return; }
        navigator.clipboard.writeText(text).then(function() {
            copyAllBtn.innerHTML = '<i class="fas fa-check"></i> Copied';
            setTimeout(function() { copyAllBtn.innerHTML = '<i class="fas fa-copy"></i> Copy All'; }, 1500);
        }).catch(function() {
            log('Clipboard copy failed. Select and copy manually.', 'warn');
        });
    });

    downloadResumeBtn.addEventListener('click', downloadAtsHtml);
    downloadAtsHtmlBtn.addEventListener('click', downloadAtsHtml);
    printAtsPdfBtn.addEventListener('click', printAtsPdf);

    generateBtn.addEventListener('click', generateContent);
    clearBtn.addEventListener('click', clearAll);

    pasteJdBtn.addEventListener('click', function() {
        var showing = pasteJdRow.style.display !== 'none';
        pasteJdRow.style.display = showing ? 'none' : 'flex';
        if (!showing) pasteJdTextarea.focus();
        fetchFailSuggestion.style.display = 'none';
    });
    cancelPasteJdBtn.addEventListener('click', function() {
        pasteJdRow.style.display = 'none';
        pasteJdTextarea.value = '';
    });
    usePastedJdBtn.addEventListener('click', async function() {
        var text = pasteJdTextarea.value.trim();
        if (!text || text.length < 30) {
            log('Paste at least a few sentences of the job description.', 'warn');
            return;
        }

        showProgress();
        updateProgress(20, 'Processing pasted description...');

        try {
            if (typeof JobScraper === 'undefined') {
                throw new Error('JobScraper library not loaded.');
            }

            const result = await JobScraper.generateResume('', { description: text });

            updateProgress(80, 'Finalizing...');

            state.jobDescription = result;

            const allKeywords = [...(result.globalTags || [])];
            if (result.sections) {
                result.sections.forEach(section => {
                    if (section.tags) {
                        section.tags.forEach(tag => {
                            if (!allKeywords.includes(tag)) allKeywords.push(tag);
                        });
                    }
                });
            }
            state.jobKeywords = allKeywords.slice(0, 20);

            renderJobDescription(result);
            log('JD loaded from pasted text.', 'success');
            log('Keywords: ' + state.jobKeywords.join(', '), 'info');
            setStatus('Success', 'success');
            statusText.textContent = 'JD loaded (' + text.length + ' chars, pasted)';
            updateGenerateButton();
            pasteJdRow.style.display = 'none';
            fetchFailSuggestion.style.display = 'none';
            hideProgress();
        } catch (error) {
            log('Error processing pasted JD: ' + error.message, 'error');
            setStatus('Error', 'error');
            statusText.textContent = 'Error: ' + error.message;
            hideProgress();
        }
    });

    // ─── Init ──────────────────────────────────────────────────
    function init() {
        if (!initRAGina()) log('RAGina init failed.', 'error');
        if (typeof JobScraper === 'undefined') {
            log('JobScraper not loaded. Please check your internet connection.', 'warn');
        } else {
            log('JobScraper loaded successfully.', 'success');
        }
        updateGenerateButton();
        loadSavedResume();
        log('CurVina Content Generator ready.', 'info');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.__curvina = {
        state: state,
        generateContent: generateContent,
        curifySection: curifySection,
        clearAll: clearAll,
        log: log
    };

})();