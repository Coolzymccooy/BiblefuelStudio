import { useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { api } from '../lib/api';
import toast from 'react-hot-toast';

export function GumroadPage() {
    const [freeTitle, setFreeTitle] = useState('7 Bible Verses for Anxiety & Fear (With Reflections & Prayers)');
    const [paidTitle, setPaidTitle] = useState('Biblefuel: 30 Days of Strength, Peace & Faith');
    const [result, setResult] = useState<{ freeMarkdown?: string; paidMarkdown?: string } | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);

    const handleGenerate = async () => {
        setIsGenerating(true);
        try {
            const response = await api.post('/api/gumroad/generate', {
                freeTitle,
                paidTitle,
            });

            if (response.ok && response.data) {
                setResult(response.data);
                toast.success('Generated Gumroad packs!');
            } else {
                toast.error(response.error || 'Generation failed');
            }
        } catch (error) {
            toast.error('An error occurred');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleDownloadZip = () => {
        api.download('/api/gumroad/download.zip');
    };

    return (
        <div>
            <h2 className="text-2xl font-bold mb-6">Gumroad Pack Builder</h2>

            <Card title="Configuration">
                <p className="text-sm text-gray-600 mb-4">
                    Generates Markdown you can paste into Gumroad, and a ZIP you can upload.
                </p>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Lead magnet title
                        </label>
                        <Input
                            value={freeTitle}
                            onChange={(e) => setFreeTitle(e.target.value)}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Paid product title
                        </label>
                        <Input
                            value={paidTitle}
                            onChange={(e) => setPaidTitle(e.target.value)}
                        />
                    </div>

                    <div className="flex gap-2">
                        <Button onClick={handleGenerate} isLoading={isGenerating}>
                            Generate
                        </Button>
                        <Button onClick={handleDownloadZip} variant="secondary">
                            Download ZIP
                        </Button>
                    </div>
                </div>
            </Card>

            {result && (
                <div className="mt-6 space-y-4">
                    {result.freeMarkdown && (
                        <Card title="Free product (Markdown)">
                            <pre className="bg-gray-100 p-4 rounded overflow-auto text-sm whitespace-pre-wrap">
                                {result.freeMarkdown}
                            </pre>
                        </Card>
                    )}

                    {result.paidMarkdown && (
                        <Card title="Paid product (Markdown)">
                            <pre className="bg-gray-100 p-4 rounded overflow-auto text-sm whitespace-pre-wrap">
                                {result.paidMarkdown}
                            </pre>
                        </Card>
                    )}
                </div>
            )}
        </div>
    );
}
