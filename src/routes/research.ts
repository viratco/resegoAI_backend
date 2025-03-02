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

    // Log authentication info
    const user = (req as any).user;
    console.log('User info:', user);

    if (!user) {
      console.log('Error: No user found in request');
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    // Generate mock report
    console.log('Generating report for query:', query);
    const mockReport = {
      report: `# Research Report: ${query}\n\nThis is a sample report.`,
      papers: [
        {
          paper: {
            title: "Sample Paper",
            authors: ["John Doe"],
            link: "https://example.com",
            abstract: "Sample abstract"
          },
          analysis: "Sample analysis of the paper."
        }
      ],
      savedReport: true
    };

    console.log('Report generated successfully');
    res.json(mockReport);
    return;

  } catch (error) {
    console.error('Error in generate report:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      time: new Date().toISOString()
    });

    res.status(500).json({ 
      error: 'Failed to generate report',
      details: error instanceof Error ? error.message : 'Unknown server error'
    });
    return;
  }
};

router.post('/generate-report', generateReportHandler);

export default router; 