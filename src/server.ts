import express, { Request, Response, Router, RequestHandler, NextFunction } from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { DOMParser } from '@xmldom/xmldom';
import { createClient } from '@supabase/supabase-js'
import { authenticateToken } from './middleware/auth';

dotenv.config();

const app = express();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, 
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)

// Configure CORS with middleware
app.use(cors({
  origin: ['https://resego-ai-frontend-3.vercel.app', 'http://localhost:5173'],
  methods: ['GET', 'POST'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

const PORT = process.env.PORT || 5002;

const router = Router();

interface SearchRequest extends Request {
  body: { query: string }
}

interface AuthenticatedRequest extends Request {
  user?: any;
}

interface Paper {
  title: string;
  authors: string[];
  abstract: string;
  link: string;
}

interface PaperAnalysis {
  paper: Paper;
  analysis: string;
}

const searchPapers = async (req: Request, res: Response): Promise<void> => {
  const { query } = req.body as { query: string };

  if (!query) {
    res.status(400).json({ error: 'Query is required' });
    return;
  }

  try {
    // Fetch papers from arXiv
    const arxivResponse = await fetch(
      `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=6`
    );

    if (!arxivResponse.ok) {
      throw new Error(`ArXiv API error: ${arxivResponse.statusText}`);
    }

    const xmlData = await arxivResponse.text();
    
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlData, "text/xml");
    const entries = xmlDoc.getElementsByTagName("entry");

    if (!entries || entries.length === 0) {
      res.json({ papers: [], summaries: [], consolidatedSummary: '' });
      return;
    }
    
    const papers = Array.from(entries).map(entry => ({
      title: entry.getElementsByTagName("title")[0]?.textContent?.replace(/\n/g, ' ').trim() || "",
      authors: Array.from(entry.getElementsByTagName("author")).map(a => a.textContent?.trim() || ""),
      abstract: entry.getElementsByTagName("summary")[0]?.textContent?.trim() || "",
      link: entry.getElementsByTagName("id")[0]?.textContent || ""
    }));

    // Get individual summaries
    const summaries = await Promise.all(papers.map(async (paper) => {
      try {
        const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'HTTP-Referer': 'http://localhost:5173',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'moonshotai/moonlight-16b-a3b-instruct:free',
            messages: [{
              role: 'user',
              content: `Provide a very brief 2-3 bullet point summary of this research paper (max 50 words total):
              Title: ${paper.title}
              Abstract: ${paper.abstract.substring(0, 1000)}`
            }],
            temperature: 0.2,
            max_tokens: 100
          }),
        });

        if (!aiResponse.ok) {
          throw new Error(`OpenRouter API error: ${aiResponse.statusText}`);
        }

        const data = await aiResponse.json();
        return data.choices?.[0]?.message?.content || 'Summary not available';
      } catch (error) {
        console.error('AI Summary error:', error);
        return 'Summary generation failed';
      }
    }));

    // Generate consolidated summary
    const consolidatedResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'http://localhost:5173',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'moonshotai/moonlight-16b-a3b-instruct:free',
        messages: [{
          role: 'user',
          content: `Synthesize a cohesive overview of these research papers (max 100 words). Focus on common themes, key findings, and broader implications. Don't list papers individually.

          Papers:
          ${papers.map(paper => `${paper.title}\n${paper.abstract}`).join('\n\n')}`
        }],
        temperature: 0.3,
        max_tokens: 200
      }),
    });

    const consolidatedData = await consolidatedResponse.json();
    const consolidatedSummary = consolidatedData.choices?.[0]?.message?.content || 'Overview not available';

    res.json({ papers, summaries, consolidatedSummary });
  } catch (error) {
    console.error('Server error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({ error: errorMessage });
  }
};

// Update the middleware type signature
const authenticateUser = (async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    res.status(401).json({ error: 'No authorization header' });
    return;
  }

  try {
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Authentication failed' });
  }
}) as RequestHandler;

// Apply middleware to protected routes
router.post('/api/search-papers', authenticateToken, (async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await searchPapers(req, res);
  } catch (error) {
    next(error);
  }
}) as RequestHandler);

router.post('/api/generate-report', authenticateToken, (async (req: Request, res: Response): Promise<void> => {
  try {
    const { query } = req.body;
    let papers: Paper[] = [];  // Declare papers array outside try block
    
    if (!query) {
      res.status(400).json({ error: 'Query is required' });
      return;
    }

    // Step 1: Fetch papers
    try {
      const arxivResponse = await fetch(
        `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=5`
      );
      
      if (!arxivResponse.ok) {
        throw new Error('Failed to fetch papers from arXiv');
      }

      const xmlData = await arxivResponse.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlData, "text/xml");
      const entries = xmlDoc.getElementsByTagName("entry");
      
      papers = Array.from(entries).map(entry => ({
        title: entry.getElementsByTagName("title")[0]?.textContent?.replace(/\n/g, ' ').trim() || "",
        authors: Array.from(entry.getElementsByTagName("author")).map(a => a.textContent?.trim() || ""),
        abstract: entry.getElementsByTagName("summary")[0]?.textContent?.trim() || "",
        link: entry.getElementsByTagName("id")[0]?.textContent || ""
      }));

    } catch (error) {
      console.error('ArXiv fetch error:', error);
      res.status(500).json({ error: 'Failed to fetch papers from arXiv' });
      return;
    }

    // Step 2: Extract key information from each paper
    const paperAnalyses = await Promise.all(papers.map(async (paper: Paper) => {
      const analysisResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'http://localhost:5173',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'moonshotai/moonlight-16b-a3b-instruct:free',
          messages: [{
            role: 'user',
            content: `Analyze this research paper and provide the following details in a structured format:
            - Research question
            - Study methodology
            - Key findings
            - Limitations
            - Conclusion

            Title: ${paper.title}
            Abstract: ${paper.abstract}`
          }],
          temperature: 0.3,
          max_tokens: 500
        }),
      });

      const data = await analysisResponse.json();
      return {
        paper,
        analysis: data.choices[0]?.message?.content || 'Analysis failed'
      } as PaperAnalysis;
    }));

    // Step 3: Generate final structured report
    const reportPrompt = `Generate a comprehensive, **evidence-based** research report about **"${query}"** following this **structured academic format**:

## <span style="color: #8B5CF6; font-size: 2.25rem; font-weight: bold;">${query}</span>

---

### 📑 **Abstract**
**Summarize** the key aspects of the research:
- **Objective**: What is the study trying to achieve?
- **Methodology Overview**: What methods were used?
- **Key Findings Summary**: What are the main results?
- **Significance**: Why is this research important?

---

### 🎯 **Introduction & Research Objectives**
Provide background information to **contextualize the research**:
- **Research Context**: Explain why this topic is important.
- **Problem Statement**: What problem does this research address?
- **Research Questions**: List specific research questions being explored.
- **Scope and Limitations**: Define the study's boundaries.

---

### 📚 **Literature Review**
Conduct a **comparative analysis** of existing research:
- **Current State of Research**: Summarize key studies and trends.
- **Theoretical Framework**: What models or theories apply?
- **Research Gaps Identified**: What gaps exist in the current literature?
- **Key Concepts Defined**: Define critical terms for clarity.

⚡ **(Ensure findings are compared against the papers provided in the dataset.)**

---

### 🔬 **Methodology**
Break down the research methods **step-by-step**:
- **Research Approach**: Is this qualitative, quantitative, or mixed?
- **Data Collection Methods**: What data sources were used?
- **Analysis Techniques**: What statistical or analytical methods were applied?
- **Tools & Frameworks Used**: Specify technologies, software, or algorithms.

---

### 📊 **Results & Analysis**
Organize key results into a **structured table** for clarity:

| **Category** | **Findings** | **Evidence** | **Impact** |
|-------------|-------------|-------------|-------------|
| [area] | [result] | [data] | [significance] |

- **Provide statistical results with proper benchmarks.**
- **Include citations from referenced papers where possible.**
- **Highlight strengths and weaknesses of the findings.**

---

### 💡 **Discussion**
Critically evaluate the findings:
- **Interpretation of Findings**: What do the results indicate?
- **Comparison with Existing Research**: How does this compare with past studies?
- **Practical Implications**: What are the real-world applications?
- **Limitations Encountered**: Mention any potential biases or errors.

---

### 🎯 **Conclusions**
Summarize **key takeaways** from the research:
- **Main Contributions**: What new insights does this study offer?
- **Key Insights**: What should researchers or practitioners take away?
- **Future Research Directions**: What questions remain unanswered?
- **Recommendations**: Suggest next steps for researchers.

---

### 📚 **References**
Provide a **properly formatted reference list**:
- **Cite relevant papers** (including those provided in the dataset).
- **Highlight key studies referenced.**
- **Ensure citations follow an academic format (APA/Harvard/IEEE).**

---

### 📌 **Analysis Guidelines for Better Research Output**
1. **Use an Academic Writing Style** (avoid vague or conversational language).  
2. **Support Claims with Evidence** (always cite data or sources).  
3. **Include Data Tables & Graphs** (where applicable).  
4. **Use Comparative Analysis** (compare findings with multiple papers).  
5. **Highlight Performance Metrics & Benchmarks** (where relevant).  
6. **Ensure Quantitative Evidence is Prioritized** (numbers, percentages, charts).  

📌 **Base your analysis on these papers and their findings:**
${paperAnalyses.map(({ paper, analysis }) => 
  `Title: **${paper.title}**  
   Authors: ${paper.authors.join(', ')}  
   Key Findings: ${analysis}  
  `
).join('\n')}

🚀 **Ensure the AI processes findings step-by-step and focuses on data-driven insights rather than vague generalizations.**`;
    // Step 3: Generate report
    try {
      const headers: HeadersInit = {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': process.env.CORS_ORIGIN || 'http://localhost:5173',
        'Content-Type': 'application/json'
      };

      if (process.env.OPENROUTER_ORG_ID) {
        headers['OpenAI-Organization'] = process.env.OPENROUTER_ORG_ID;
      }

      const reportResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'moonshotai/moonlight-16b-a3b-instruct:free',
          messages: [{
            role: 'user',
            content: reportPrompt
          }],
          temperature: 0.3,
          max_tokens: 2000
        }),
      });

      if (!reportResponse.ok) {
        const error = await reportResponse.json();
        throw new Error(error.message || 'OpenRouter API error');
      }

      const reportData = await reportResponse.json();
      const finalReport = reportData.choices[0]?.message?.content;

      if (!finalReport) {
        throw new Error('No report content generated');
      }

      // Step 4: Save to Supabase
      try {
        const user = (req as any).user;
        if (!user || !user.id) {
          throw new Error('No authenticated user found');
        }

        // Then insert the report directly (remove user verification)
        const { data: reportRecord, error: saveError } = await supabase
          .from('reports')
          .insert({
            user_id: user.id,
            title: query,
            content: finalReport
          })
          .select()
          .single();

        if (saveError) {
          console.error('Supabase save error:', saveError);
          throw new Error(`Failed to save report: ${saveError.message}`);
        }

        if (!reportRecord) {
          throw new Error('No report record returned after save');
        }

        res.json({
          report: finalReport,
          papers: paperAnalyses,
          savedReport: reportRecord
        });

      } catch (error) {
        console.error('Database save error:', error);
        res.status(500).json({ 
          error: error instanceof Error ? error.message : 'Failed to save report to database' 
        });
      }

    } catch (error) {
      console.error('Report generation error:', error);
      res.status(500).json({ error: 'Failed to generate report content' });
    }

  } catch (error) {
    console.error('General error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to process request'
    });
  }
}) as RequestHandler);

// Modify the prompt suggestion endpoint
router.post('/api/suggest-prompt', authenticateUser, (async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { initialQuery } = req.body;
    const suggestionResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'http://localhost:5173',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'moonshotai/moonlight-16b-a3b-instruct:free',
        messages: [{
          role: 'user',
          content: `As a research assistant, analyze this query and suggest improvements:
          
          Original query: "${initialQuery}"

          Provide response in this JSON format:
          {
            "refinedQuery": "improved version of the query",
            "suggestedElements": {
              "specificity": [
                "specific aspect 1",
                "specific aspect 2"
              ],
              "researchType": [
                "methodology 1",
                "methodology 2"
              ],
              "practicalApplication": [
                "application 1",
                "application 2"
              ]
            },
            "questionVariations": [
              {
                "question": "more specific version of the query",
                "explanation": "why this version is more effective"
              },
              {
                "question": "alternative approach to the query",
                "explanation": "how this approach differs"
              }
            ],
            "relatedConcepts": [
              "technical term 1",
              "technical term 2"
            ]
          }

          Guidelines:
          1. Make suggestions more specific and measurable
          2. Include relevant technical terms
          3. Consider different research approaches
          4. Focus on practical applications
          5. Break down complex queries into specific elements`
        }],
        temperature: 0.3,
        max_tokens: 800
      }),
    });

    const data = await suggestionResponse.json();
    const suggestions = JSON.parse(data.choices[0]?.message?.content || '{}');
    
    const researchTags = await getResearchTags(initialQuery);
    suggestions.researchTags = researchTags;

    res.json(suggestions);
  } catch (error) {
    next(error);
  }
}) as RequestHandler);

// Helper function to generate research tags
async function getResearchTags(query: string): Promise<string[]> {
  try {
    const tagResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'http://localhost:5173',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'moonshotai/moonlight-16b-a3b-instruct:free',
        messages: [{
          role: 'user',
          content: `Generate 3-4 relevant research type tags for this query: "${query}"
          Return only the tags separated by commas, like: "Specificity, Research type, Practical application"`
        }],
        temperature: 0.2,
        max_tokens: 100
      }),
    });

    const data = await tagResponse.json();
    return data.choices[0]?.message?.content.split(',').map((tag: string) => tag.trim()) || [];
  } catch (error) {
    console.error('Tag generation error:', error);
    return [];
  }
}

router.post('/api/analyze-paper', authenticateToken, (async (req: Request, res: Response): Promise<void> => {
  try {
    const { abstract } = req.body;
    
    if (!abstract) {
      res.status(400).json({ error: 'Abstract is required' });
      return;
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': process.env.CORS_ORIGIN || 'http://localhost:5173',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'moonshotai/moonlight-16b-a3b-instruct:free',
        messages: [{
          role: 'user',
          content: `Give 3 one-line bullet points (max 10 words each):
          • What: Main goal?
          • How: Key method?
          • Result: Key finding?

          Abstract: ${abstract}`
        }],
        temperature: 0.3,
        max_tokens: 100
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to generate AI summary');
    }

    const data = await response.json();
    res.json({ summary: data.choices[0]?.message?.content || 'Failed to generate summary' });
  } catch (error) {
    console.error('Error analyzing paper:', error);
    res.status(500).json({ error: 'Failed to analyze paper' });
  }
}) as RequestHandler);

router.post('/api/save-search', authenticateToken, (async (req: Request, res: Response): Promise<void> => {
  try {
    const { query, papers, consolidatedSummary } = req.body;
    const user = (req as any).user;

    if (!user || !user.id) {
      throw new Error('No authenticated user found');
    }

    // Save to Supabase with search type
    const { data: savedSearch, error: saveError } = await supabase
      .from('reports')
      .insert({
        user_id: user.id,
        title: query,
        content: consolidatedSummary,
        papers: papers,
        type: 'search',
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (saveError) {
      console.error('Supabase save error:', saveError);
      throw new Error(`Failed to save search: ${saveError.message}`);
    }

    res.json({
      savedSearch,
      message: 'Search saved successfully'
    });

  } catch (error) {
    console.error('Save search error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to save search'
    });
  }
}) as RequestHandler);

app.use(router);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 