import { marked } from 'marked';
import { GUIDE_MARKDOWN } from '@/content/guide';

marked.setOptions({ gfm: true, breaks: true });

export const metadata = {
  title: 'Guide',
};

export default function GuidePage() {
  const html = marked.parse(GUIDE_MARKDOWN) as string;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[720px] mx-auto px-8 py-10">
        <p className="text-[13px] font-medium text-minimal-muted mb-2">Guide</p>
        <h1 className="text-2xl font-semibold text-white mb-8">How this Compound works</h1>

        <div
          className="[&_h2]:text-white [&_h2]:text-[15px] [&_h2]:font-semibold [&_h2]:mt-9 [&_h2]:mb-3 [&_h2:first-child]:mt-0
                     [&_p]:text-zinc-400 [&_p]:text-[14px] [&_p]:leading-relaxed [&_p]:mb-4
                     [&_strong]:text-white [&_strong]:font-semibold
                     [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-4 [&_ul]:text-zinc-400 [&_ul]:text-[14px]
                     [&_li]:mb-1.5"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}
