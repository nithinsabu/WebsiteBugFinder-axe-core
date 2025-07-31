import express, { Request, Response } from "express";
import puppeteer from "puppeteer";
import * as axe from "axe-core";
import lighthouse from "lighthouse";
import { type Flags, RunnerResult } from "lighthouse";
import chromeLauncher from "chrome-launcher";
import { v4 as uuidv4 } from "uuid";

declare global {
    var sessionHtmlMap: Record<string, string>;
}
interface ViolationNode {
    impact?: string;
    html: string;
    failureSummary?: string;
}

interface ResultViolation {
    id: string;
    description: string;
    help: string;
    nodes: ViolationNode[];
}
interface LighthouseAuditResult {
    loadingExperience: {
        overall_category: "GOOD" | "NEEDS IMPROVEMENT" | "POOR";
        metrics: {
            labTest: true;
            FIRST_CONTENTFUL_PAINT_MS: {
                percentile: number;
                category: "GOOD" | "NEEDS IMPROVEMENT" | "POOR";
            };
            LARGEST_CONTENTFUL_PAINT_MS: {
                percentile: number;
                category: "GOOD" | "NEEDS IMPROVEMENT" | "POOR";
            };
            CUMULATIVE_LAYOUT_SHIFT_SCORE: {
                percentile: number;
                category: "GOOD" | "NEEDS IMPROVEMENT" | "POOR";
            };
            INTERACTION_TO_NEXT_PAINT: {
                percentile: number;
                category: "GOOD" | "NEEDS IMPROVEMENT" | "POOR";
            };
            EXPERIMENTAL_TIME_TO_FIRST_BYTE: {
                percentile: number;
                category: "GOOD" | "NEEDS IMPROVEMENT" | "POOR";
            };
        };
    };
    lighthouseResult: {
        categories: {
            performance: { score: number };
            accessibility: { score: number };
            "best-practices": { score: number };
            seo: { score: number };
        };
    };
}

interface ResponsivenessResult {
  viewport: string,
  overflow: boolean,
  imagesOversize?: boolean
}
const PORT = process.env.PORT || 4000;
const app = express();
app.use(express.json({ limit: "2mb" }));

async function runLighthouseAudit(htmlText: string): Promise<LighthouseAuditResult> {
    if (!htmlText) throw new Error("Provide htmlText");
    const sessionId = uuidv4();
    global.sessionHtmlMap = global.sessionHtmlMap || {};
    global.sessionHtmlMap[sessionId] = htmlText;
    const auditUrl = `http://localhost:${PORT}/__lighthouse-session/${sessionId}`;

    const chrome = await chromeLauncher.launch({ chromeFlags: ["--headless"] });
    const options: Flags = {
        logLevel: "silent",
        output: "json",
        onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
        port: chrome.port,
    };

    const result: RunnerResult | undefined = await lighthouse(auditUrl, options);
    const report = JSON.parse(result?.report as string);
    const audits = report.audits;
    // console.log(report.categories);
    const fcp = audits["first-contentful-paint"].numericValue;
    const lcp = audits["largest-contentful-paint"].numericValue;
    const cls = audits["cumulative-layout-shift"].numericValue;
    const inp = audits["total-blocking-time"].numericValue;
    const ttfb = audits["server-response-time"].numericValue;

    const response: LighthouseAuditResult = {
        loadingExperience: {
            overall_category: report.categories.performance.score >= 0.9 ? "GOOD" : report.categories.performance.score >= 0.5 ? "NEEDS IMPROVEMENT" : "POOR",
            metrics: {
                labTest: true,
                FIRST_CONTENTFUL_PAINT_MS: {
                    percentile: Math.round(fcp),
                    category: fcp <= 1800 ? "GOOD" : fcp <= 3000 ? "NEEDS IMPROVEMENT" : "POOR",
                },
                LARGEST_CONTENTFUL_PAINT_MS: {
                    percentile: Math.round(lcp),
                    category: lcp <= 2500 ? "GOOD" : lcp <= 4000 ? "NEEDS IMPROVEMENT" : "POOR",
                },
                CUMULATIVE_LAYOUT_SHIFT_SCORE: {
                    percentile: cls,
                    category: cls <= 0.1 ? "GOOD" : cls <= 0.25 ? "NEEDS IMPROVEMENT" : "POOR",
                },
                INTERACTION_TO_NEXT_PAINT: {
                    percentile: Math.round(inp),
                    category: inp <= 200 ? "GOOD" : inp <= 500 ? "NEEDS IMPROVEMENT" : "POOR",
                },
                EXPERIMENTAL_TIME_TO_FIRST_BYTE: {
                    percentile: Math.round(ttfb),
                    category: ttfb <= 800 ? "GOOD" : ttfb <= 1800 ? "NEEDS IMPROVEMENT" : "POOR",
                },
            },
        },
        lighthouseResult: {
            categories: {
                performance: { score: report.categories.performance.score },
                accessibility: { score: report.categories.accessibility.score },
                ["best-practices"]: { score: report.categories["best-practices"].score },
                seo: { score: report.categories.seo.score },
            },
        },
    };

    await chrome.kill();

    delete global.sessionHtmlMap?.[sessionId];

    return response;
}
app.get("/__lighthouse-session/:sessionId", (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const html = global.sessionHtmlMap[sessionId];

    if (!html) {
        res.status(404).send("Session not found");
        return;
    }

    res.setHeader("Content-Type", "text/html");
    res.send(html);
});

app.post("/analyse", async (req: Request, res: Response) => {
    let browser;
    try {
        console.log(req.body)
        const html: string | undefined = req.body.html;
        const url: string | undefined = req.body.url;
        const lightHouseRequired: boolean | undefined = req.query.lightHouseRequired === "true";
        const resultViolations: ResultViolation[] = [];
        let lightHouseResults: LighthouseAuditResult | null = null;
        const responsivenessResults: ResponsivenessResult[] = [];
        if (!html && !url) {
            res.status(400).json({ error: "Html field or url field must be specified" });
            return;
        }
        if (html && url) {
            res.status(400).json({ error: "Specify either html or url field" });
            return;
        }
        // axe core puppeteer
        try {
            browser = await puppeteer.launch({ headless: true });
            const page = await browser.newPage();
            if (html) {
                try {
                    await page.setContent(html, { waitUntil: "networkidle0" });
                } catch (err) {
                    res.status(500).json({ error: err instanceof Error ? `Failed to set HTML content: ${err.message}` : "An unknown error occurred while setting HTML content." });
                }
            } else if (url) {
                try {
                    new URL(url);
                    await page.goto(url, { waitUntil: "networkidle0" });
                } catch (err) {
                    res.status(500).json({ error: err instanceof Error ? `Failed to Load URL: ${err.message}` : "An unknown error occurred while navigating to the URL." });
                }
            }
            await page.addScriptTag({ content: axe.source });
            const axeResults = await page.evaluate(() => axe.run());

            //Responsiveness
            const viewports = [
                { name: "Desktop Large", width: 1920, height: 1080 },
                { name: "Desktop Standard", width: 1280, height: 800 },
                { name: "Tablet", width: 768, height: 1024 },
                { name: "Phone", width: 375, height: 667 },
            ];
            try {
                for (const vp of viewports) {
                    await page.setViewport({ width: vp.width, height: vp.height });
                    await new Promise(resolve => setTimeout(resolve, 200));

                    const result = await page.evaluate(() => {
                        const overflow = document.body.scrollWidth > window.innerWidth;
                        const imagesOversize = Array.from(document.images).some(img => img.naturalWidth > img.clientWidth);
                        return { overflow, imagesOversize };
                    });
                    // console.log(result.overflow)
                    responsivenessResults.push({
                        viewport: vp.name,
                        overflow: result.overflow,
                        // imagesOversize: result.imagesOversize,
                    });
                }
            } catch {}
            await browser.close();
            const violations = axeResults.violations;

            violations.forEach(violation => {
                const resultViolation: ResultViolation = { id: violation.id || "", description: violation.description || "", help: violation.help || "", nodes: [] };
                for (const node of violation.nodes) {
                    resultViolation.nodes.push({ impact: node.impact || "", html: node.html || "", failureSummary: node.failureSummary || "" });
                }
                resultViolations.push(resultViolation);
            });

        } catch (err) {}

        // LightHouse

        try {
            // console.log(lightHouseRequired, html)
            if (lightHouseRequired && html) lightHouseResults = await runLighthouseAudit(html);
        } catch {}
        // console.log(resultViolations);
        // console.log(responsivenessResults)
        console.log({ violations: resultViolations, lightHouseResults, responsivenessResults })
        res.json({ violations: resultViolations, lightHouseResults, responsivenessResults });
    } catch (err) {
        let errorMessage = "An unexpected server error occurred during accessibility analysis.";
        if (err instanceof Error) {
            errorMessage = `Analysis failed: ${err.message}`;
        }
        res.status(500).json({ error: errorMessage });
    } finally {
        if (browser) browser.close();
    }
});

app.listen(PORT, () => console.log("Axe TypeScript API running on port 4000"));
