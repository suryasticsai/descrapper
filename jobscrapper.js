/**
 * jobdescrapper.js – A lightweight library to scrape job descriptions and generate ATS resume blueprints.
 * 
 * Usage:
 *   <script src="https://your-cdn.com/jobdescrapper.js"></script>
 *   <script>
 *     JobScraper.generateResume('https://example.com/job-posting')
 *       .then(result => console.log(result.resumeBlueprint))
 *       .catch(err => console.error(err));
 *   </script>
 * 
 * Options:
 *   - description: string (skip scraping and use this text instead)
 *   - aiEndpoint: string (override the default RAGina API endpoint)
 *   - timeout: number (milliseconds, default 60000)
 * 
 * Returns a Promise resolving to an object:
 *   {
 *     job: { title, company, status },
 *     sections: [ { name, content, tags, wordCount } ],
 *     globalTags: [string],
 *     resumeBlueprint: { "Professional Summary": "...", ... },
 *     fullDescription: string,
 *     exportedAt: ISO string
 *   }
 */

(function(global) {
  'use strict';

  // ─── Default configuration ───
  const DEFAULTS = {
    aiEndpoint: 'https://ragina-crawler-ragina.vercel.app/api/ask',
    timeout: 60000,
  };

  // ─── Utility functions ───
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function extractKeywords(text, limit = 12) {
    const words = text.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
    const stopwords = new Set([
      'and','the','for','with','you','are','your','from','this','that','have','will','can',
      'our','all','about','also','has','been','more','than','its','one','two','three','was',
      'were','what','when','where','which','who','why','how','some','any','may','should',
      'could','would','does','did','done','very','just','only','own','same','so','up','down',
      'off','over','under','above','below','between','among','through','during','without',
      'within','upon','toward','etc','inc','ltd'
    ]);
    const freq = {};
    for (const w of words) {
      if (!stopwords.has(w) && w.length > 2) {
        freq[w] = (freq[w] || 0) + 1;
      }
    }
    const sorted = Object.entries(freq).sort((a,b) => b[1] - a[1]);
    return sorted.slice(0, limit).map(item => item[0]);
  }

  function extractGlobalTags(text, limit = 20) {
    const words = text.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
    const stopwords = new Set([
      'and','the','for','with','you','are','your','from','this','that','have','will','can',
      'our','all','about','also','has','been','more','than','its','one','two','three','was',
      'were','what','when','where','which','who','why','how','some','any','may','should',
      'could','would','does','did','done','very','just','only','own','same','so','up','down',
      'off','over','under','above','below','between','among','through','during','without',
      'within','upon','toward','etc','inc','ltd',
      'responsibilities','responsibility','requirement','requirements','qualifications',
      'qualification','experience','skills','skill','education','certifications','certification',
      'location','benefits','company','team','culture','career','growth','diversity','inclusion',
      'performance','metrics','schedule','hours','travel','relocation','bonus','salary',
      'compensation','pay','range'
    ]);
    const freq = {};
    for (const w of words) {
      if (!stopwords.has(w) && w.length > 2) {
        freq[w] = (freq[w] || 0) + 1;
      }
    }
    const sorted = Object.entries(freq).sort((a,b) => b[1] - a[1]);
    return sorted.slice(0, limit).map(item => item[0]);
  }

  // ─── Section splitting engine ───
  const SECTION_KEYWORDS = [
    { name: '📋 About the Role', patterns: ['about the role', 'role overview', 'position summary', 'job description', 'overview'] },
    { name: '📌 Key Responsibilities', patterns: ['responsibilities', 'what you\'ll do', 'key duties', 'role responsibilities', 'core responsibilities', 'you will be responsible for'] },
    { name: '📋 Requirements', patterns: ['requirements', 'qualifications', 'what you\'ll bring', 'must have', 'basic qualifications', 'minimum qualifications'] },
    { name: '💼 Experience', patterns: ['experience', 'years of experience', 'professional experience', 'work experience', 'industry experience'] },
    { name: '🛠️ Technical Skills', patterns: ['technical skills', 'programming', 'languages', 'frameworks', 'tools', 'technologies', 'proficiency in'] },
    { name: '🤝 Soft Skills', patterns: ['soft skills', 'communication', 'leadership', 'interpersonal', 'problem solving', 'critical thinking', 'teamwork'] },
    { name: '🎓 Education', patterns: ['education', 'degree', 'academic requirements', 'field of study', 'gpa', 'bachelor', 'master', 'phd'] },
    { name: '📜 Certifications', patterns: ['certifications', 'certificates', 'licenses', 'professional certifications', 'accreditations'] },
    { name: '👤 About You', patterns: ['about you', 'who you are', 'your profile', 'ideal candidate', 'personal qualities'] },
    { name: '💰 Pay & Compensation', patterns: ['pay', 'salary', 'compensation', 'base pay', 'total rewards', 'bonus', 'equity', 'range'] },
    { name: '🎁 Benefits', patterns: ['benefits', 'perks', 'health insurance', 'retirement', 'time off', 'wellness', 'vacation'] },
    { name: '📍 Location', patterns: ['location', 'remote', 'hybrid', 'office', 'work from', 'telecommute', 'on-site'] },
    { name: '📈 Additional Preferences', patterns: ['additional preferences', 'nice to have', 'preferred qualifications', 'bonus points', 'plus'] },
    { name: '🏢 About Company', patterns: ['about company', 'who we are', 'our culture', 'our values', 'mission', 'vision'] },
    { name: '👥 Team Culture', patterns: ['about the team', 'our team', 'team culture', 'work environment', 'collaboration'] },
    { name: '📈 Career Growth', patterns: ['career growth', 'development', 'learning', 'growth opportunities', 'career progression'] },
    { name: '🌍 Diversity & Inclusion', patterns: ['diversity', 'inclusion', 'equal opportunity', 'belonging', 'dei'] },
    { name: '📊 Performance Metrics', patterns: ['metrics', 'kpis', 'performance', 'goals', 'okrs', 'targets'] },
    { name: '🗓️ Schedule & Hours', patterns: ['schedule', 'hours', 'shift', 'work hours', 'flexibility', 'overtime'] },
    { name: '✈️ Travel', patterns: ['travel', 'relocation', 'client visits', 'business trips'] }
  ];

  function buildSectionRegex() {
    const patternMap = [];
    for (const sec of SECTION_KEYWORDS) {
      for (const pat of sec.patterns) {
        patternMap.push({ pattern: pat, name: sec.name });
      }
    }
    patternMap.sort((a,b) => b.pattern.length - a.pattern.length);
    return patternMap.map(p => ({ regex: p.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), name: p.name }));
  }

  function splitIntoSections(text) {
    if (!text) return [];
    let clean = text.replace(/\s+/g, ' ').trim();
    const sectionRegex = buildSectionRegex();
    const found = [];
    for (const item of sectionRegex) {
      const regex = new RegExp(item.regex, 'gi');
      let match;
      while ((match = regex.exec(clean)) !== null) {
        found.push({ index: match.index, length: match[0].length, name: item.name });
      }
    }
    found.sort((a,b) => a.index - b.index);
    if (found.length === 0) {
      return [{ name: '📋 Job Description', content: clean }];
    }
    const sectionMap = {};
    let lastIndex = 0;
    for (let i = 0; i < found.length; i++) {
      const current = found[i];
      const next = found[i+1];
      const start = current.index + current.length;
      const end = next ? next.index : clean.length;
      const content = clean.substring(start, end).trim();
      if (content) {
        if (!sectionMap[current.name]) sectionMap[current.name] = '';
        sectionMap[current.name] += (sectionMap[current.name] ? '\n' : '') + content;
      }
    }
    const result = Object.keys(sectionMap).map(key => ({
      name: key,
      content: sectionMap[key].trim()
    }));
    if (result.length === 0) return [{ name: '📋 Job Description', content: clean }];
    return result;
  }

  // ─── HTML extraction ───
  function extractDescription(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (let script of scripts) {
      try {
        const json = JSON.parse(script.textContent);
        if (json['@type'] === 'JobPosting' || (Array.isArray(json['@type']) && json['@type'].includes('JobPosting'))) {
          let desc = json.description || '';
          if (desc && desc.includes('<')) {
            const div = document.createElement('div');
            div.innerHTML = desc;
            desc = div.textContent || desc;
          }
          return desc;
        }
      } catch (e) { /* ignore */ }
    }
    const selectors = [
      '[data-automation-id="jobPostingDescription"]',
      '[data-automation-id="job-posting-details"]',
      '.job-description', '#job-description',
      '.description', '.job-details', '.posting-description',
      '.content', 'article', '.jd-description'
    ];
    for (const sel of selectors) {
      const el = doc.querySelector(sel);
      if (el) {
        let text = el.textContent?.trim() || '';
        if (text.length > 50) return text;
      }
    }
    return doc.body?.textContent?.trim() || '';
  }

  function extractJobInfo(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    let title = '', company = '';
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (let script of scripts) {
      try {
        const json = JSON.parse(script.textContent);
        if (json['@type'] === 'JobPosting' || (Array.isArray(json['@type']) && json['@type'].includes('JobPosting'))) {
          title = json.title || title;
          if (json.hiringOrganization) {
            company = typeof json.hiringOrganization === 'string' ? json.hiringOrganization : (json.hiringOrganization.name || company);
          }
          break;
        }
      } catch (e) { /* ignore */ }
    }
    if (!title) {
      title = doc.querySelector('title')?.textContent?.trim() || '';
      const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() || '';
      if (ogTitle && ogTitle.length > title.length) title = ogTitle;
    }
    if (!company) {
      const ogSite = doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim() || '';
      if (ogSite) company = ogSite;
    }
    return { title, company };
  }

  // ─── Fetch with CORS proxies ───
  async function fetchHTML(url) {
    const proxies = [
      `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
      `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
      `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
    ];
    for (const proxy of proxies) {
      try {
        const response = await fetch(proxy);
        if (response.ok) {
          const html = await response.text();
          if (html.length > 500) return html;
        }
      } catch (e) { continue; }
    }
    throw new Error('Could not fetch the page content.');
  }

  // ─── AI call (RAGina) ───
  async function callAI(prompt, endpoint) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ prompt })
      });
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const data = await response.json();
      return data.text || data;
    } catch (error) {
      console.error('AI error:', error);
      throw error;
    }
  }

  // ─── Parse AI response into 20 sections ───
  function parseResumeData(rawText) {
    let text = rawText.replace(/\*\*/g, '').replace(/\* /g, '').trim();
    const sections = {};
    const sectionNames = [
      'Professional Summary',
      'Career Objective / Target Role',
      'Core Skills',
      'Technical Proficiency Matrix',
      'Professional Experience',
      'Key Projects',
      'Primary Responsibilities',
      'Required Qualifications',
      'Preferred Qualifications',
      'Education',
      'Certifications',
      'Languages',
      'Leadership Experience',
      'Professional Affiliations',
      'Open Source / Volunteer Work',
      'Honors & Awards',
      'Publications / Patents',
      'ATS Keywords',
      'Resume Achievement Suggestions',
      'Interview Focus Areas'
    ];
    const lines = text.split('\n');
    let currentSection = null;
    let currentContent = [];
    for (let line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(/^(\d+)\.\s*(.+)$/);
      if (match) {
        if (currentSection) {
          sections[currentSection] = currentContent.join('\n').trim();
        }
        const num = parseInt(match[1]);
        const name = match[2].trim();
        let foundName = null;
        for (const sn of sectionNames) {
          if (name.toLowerCase().includes(sn.toLowerCase()) || sn.toLowerCase().includes(name.toLowerCase())) {
            foundName = sn;
            break;
          }
        }
        if (!foundName) {
          const idx = num - 1;
          if (idx >= 0 && idx < sectionNames.length) {
            foundName = sectionNames[idx];
          } else {
            foundName = name;
          }
        }
        currentSection = foundName;
        currentContent = [];
      } else if (currentSection) {
        if (trimmed) {
          currentContent.push(trimmed);
        } else {
          currentContent.push('');
        }
      }
    }
    if (currentSection && currentContent.length) {
      sections[currentSection] = currentContent.join('\n').trim();
    }
    for (const sn of sectionNames) {
      if (!sections[sn]) sections[sn] = '';
    }
    return sections;
  }

  // ─── Build the AI prompt ───
  function buildPrompt(sections) {
    const context = sections.map(s => `${s.name}: ${s.content}`).join('\n\n');
    return `
You are an expert ATS Resume Writer, Technical Recruiter, and Hiring Manager.

Analyze the provided Job Description sections and generate an ATS-optimized resume blueprint tailored specifically for this role.

Instructions:
- Use only information from the Job Description.
- Do not invent candidate experience.
- Extract and organize the most important information into resume-ready sections.
- Prioritize ATS keyword matching.
- Rank technical skills based on importance.
- Include exact keywords wherever possible.
- Avoid markdown, bold, italics, tables, emojis, or introductory text.
- Return clean plain text only.
- Use numbered headings (1., 2., 3., etc.) for each section in the exact order below.
- For bulleted items, use the bullet character • (U+2022) at the start of each line.

Generate the following sections in this exact order:

1. Professional Summary
   - Write a concise 4‑6 line ATS‑friendly professional summary describing the ideal candidate.

2. Career Objective / Target Role
   - A one‑sentence statement of the exact role you are targeting.

3. Core Skills
   - List technical skills grouped by category with colon (e.g., "Programming Languages: Java, Python")
   - Include these categories: Programming Languages, Frameworks, Cloud, Databases, DevOps, Frontend, Security, Methodologies, Tools, Soft Skills.

4. Technical Proficiency Matrix (optional)
   - If the JD mentions experience levels, list key technologies with proficiency: Expert / Advanced / Intermediate / Beginner.

5. Professional Experience
   - Create 2‑3 placeholder job entries with:
     - Job title, company, dates (use placeholders)
     - 3‑5 bullet points of key achievements using strong action verbs and measurable results.

6. Key Projects
   - List 3‑5 major projects relevant to the role.

7. Primary Responsibilities (from the JD)
   - Extract the key responsibilities as bullet points (each starting with •).

8. Required Qualifications
   - List all mandatory qualifications as bullet points (each starting with •).

9. Preferred Qualifications
   - List all preferred qualifications as bullet points (each starting with •).

10. Education
    - Include degree, major, university, graduation year, and relevant coursework.

11. Certifications
    - List certifications mentioned or suggested.

12. Languages
    - List human languages with proficiency levels.

13. Leadership Experience
    - Describe team lead, mentorship, or project ownership roles.

14. Professional Affiliations
    - List relevant memberships (e.g., IEEE, ACM, PMI).

15. Open Source / Volunteer Work
    - Include open‑source contributions, GitHub repos, or volunteer technical work.

16. Honors & Awards
    - List any academic or professional awards.

17. Publications / Patents (if applicable)
    - List any research papers, articles, or patents.

18. ATS Keywords
    - Provide the top 40‑60 ATS keywords separated by commas.

19. Resume Achievement Suggestions
    - Suggest 10 measurable achievement statements using placeholders (each starting with •).

20. Interview Focus Areas
    - List the top technical topics likely to be covered during interviews (each starting with •).

The response must be optimized for ATS systems such as Workday, Greenhouse, Lever, Taleo, Oracle HCM, SAP SuccessFactors, and iCIMS.

Job Description (selected sections):
${context}
`;
  }

  // ─── Main public function ───
  async function generateResume(url, options = {}) {
    const config = { ...DEFAULTS, ...options };
    const { description, aiEndpoint, timeout } = config;

    let html, desc, jobInfo;

    try {
      if (description) {
        // Use provided description
        desc = description;
        jobInfo = { title: 'Pasted Job Description', company: 'Unknown' };
      } else {
        // Scrape from URL
        html = await fetchHTML(url);
        // Check for closed job
        if (html.toLowerCase().includes('this job is no longer available') || html.toLowerCase().includes('job has been closed')) {
          return { error: 'Job closed' };
        }
        jobInfo = extractJobInfo(html);
        desc = extractDescription(html);
      }

      // Check word count
      const wordCount = desc.split(/\s+/).filter(w => w.length > 0).length;
      if (wordCount < 15) {
        throw new Error('Description too short (<15 words). Please provide a full job description.');
      }

      // Split into sections
      const sections = splitIntoSections(desc);
      const globalTags = extractGlobalTags(desc, 20);

      // Generate resume blueprint
      const prompt = buildPrompt(sections);
      let aiResult = await callAI(prompt, aiEndpoint);
      aiResult = aiResult.replace(/\*\*/g, '').replace(/\* /g, '').trim();
      const blueprint = parseResumeData(aiResult);

      // Prepare final result
      const result = {
        exportedAt: new Date().toISOString(),
        job: {
          title: jobInfo.title || 'Unknown',
          company: jobInfo.company || 'Unknown',
          status: description ? 'Pasted' : 'Active'
        },
        sections: sections.map(s => ({
          name: s.name,
          content: s.content,
          wordCount: s.content.split(/\s+/).length || 0,
          tags: extractKeywords(s.content, 12)
        })),
        globalTags,
        resumeBlueprint: blueprint,
        fullDescription: desc,
        // include the raw AI output for debugging
        _rawAI: aiResult
      };

      return result;

    } catch (error) {
      console.error('JobScraper error:', error);
      throw error;
    }
  }

  // ─── Expose to global ───
  const JobScraper = {
    generateResume,
    version: '1.0.0'
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = JobScraper;
  } else {
    global.JobScraper = JobScraper;
  }

})(typeof window !== 'undefined' ? window : global);