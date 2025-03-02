import express, { RequestHandler } from 'express';

const router = express.Router();

interface GenerateReportBody {
  query: string;
}

type GenerateReportHandler = RequestHandler<{}, any, GenerateReportBody>;

const generateReportHandler: RequestHandler = async (req, res) => {
  try {
    const { query } = req.body;
    
    if (!query) {
      res.status(400).json({ error: 'Query is required' });
      return;
    }

    // Add logging to debug
    console.log('Generating report for query:', query);
    console.log('User:', (req as any).user);

    // TODO: Implement actual report generation
    const mockReport = {
      report: `# Research Report: ${query}\n\nThis is a sample report.`,
      papers: [
        {
          paper: {
            title: "Sample Paper",
            authors: ["John Doe"],
            link: "https://example.com"
          },
          analysis: "Sample analysis of the paper."
        }
      ]
    };

    res.json(mockReport);
    return;
  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to generate report',
      details: error
    });
    return;
  }
};

router.post('/generate-report', generateReportHandler);

export default router; 