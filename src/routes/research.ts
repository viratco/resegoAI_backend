import express, { RequestHandler } from 'express';

const router = express.Router();

interface GenerateReportBody {
  query: string;
}

type GenerateReportHandler = RequestHandler<{}, any, GenerateReportBody>;

const generateReportHandler: RequestHandler = async (req, res) => {
  console.log('Request received for report generation');
  
  try {
    const { query } = req.body;
    console.log('Query received:', query);
    
    if (!query) {
      console.log('Error: No query provided');
      res.status(400).json({ error: 'Query is required' });
      return;
    }

    // Generate mock report with safe defaults
    const mockReport = {
      report: `# Research Report: ${query}\n\n## Introduction\nThis is a research report about ${query}.\n\n## Key Findings\n- Finding 1\n- Finding 2\n\n## Conclusion\nThis concludes the research report.`,
      papers: [
        {
          paper: {
            title: "Example Research Paper",
            authors: ["John Doe", "Jane Smith"],
            link: "https://example.com/paper1",
            abstract: "This is a sample abstract for the research paper."
          },
          analysis: "This paper provides valuable insights into the research topic."
        }
      ],
      savedReport: {
        id: 1,
        title: query,
        content: "Sample report content"
      }
    };

    console.log('Sending response:', mockReport);
    res.json(mockReport);
    return;

  } catch (error) {
    console.error('Error in generate report:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to generate report'
    });
    return;
  }
};

router.post('/generate-report', generateReportHandler);

export default router; 