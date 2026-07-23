import type { ReactElement, ReactNode } from 'react'
import { mIcon } from '../components/m-icon'

const DashboardIcon = mIcon('space_dashboard')
const MenuBookIcon = mIcon('menu_book')
const AnalyticsIcon = mIcon('analytics')
const BotIcon = mIcon('smart_toy')
const LibraryBooksIcon = mIcon('library_books')
const HistoryIcon = mIcon('history')
const AutoAwesomeIcon = mIcon('auto_awesome')
const QuizIcon = mIcon('quiz')
const StyleIcon = mIcon('style')
const AccountTreeIcon = mIcon('account_tree')
const ChecklistIcon = mIcon('checklist')
const BiotechIcon = mIcon('biotech')
const FunctionsIcon = mIcon('functions')
const CodeIcon = mIcon('code')
const PaletteIcon = mIcon('palette')
const PublicIcon = mIcon('public')
const RecordVoiceIcon = mIcon('record_voice_over')
const SchoolIcon = mIcon('school')
const ScienceIcon = mIcon('science')
const ArticleIcon = mIcon('article')
const ErrorIcon = mIcon('error')
const SupportIcon = mIcon('support_agent')
const FeedbackIcon = mIcon('rate_review')
const HelpIcon = mIcon('help')
const UnfoldIcon = mIcon('unfold_more')

interface DashboardProps {
  onOpenWizard: () => void
  onOpenLesson: () => void
  onOpenGallery: (mode: 'generative' | 'errors') => void
}

/** Collage AI wordmark in navy for the light dashboard sidebar. */
function DashLogo(): ReactElement {
  return (
    <span className="select-none font-serif text-[21px] leading-7 tracking-tight text-navy">
      Collage
      <span className="font-semibold">
        <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(115deg, #ff8bd2 10%, #c77dff 90%)' }}>
          {'Λ'}
        </span>
        <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(115deg, #7db9ff 10%, #38a2ff 90%)' }}>
          I
        </span>
      </span>
    </span>
  )
}

function NavItem({ icon: Icon, label, active, onClick }: { icon: typeof DashboardIcon; label: string; active?: boolean; onClick?: () => void }): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-sm transition-colors ${active ? 'border border-line bg-cream-400/50 font-medium text-navy' : 'text-navy/70 hover:bg-navy/5 hover:text-navy'}`}
    >
      <Icon size={17} />
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
    </button>
  )
}

/** Small create-category card (Worksheets / Games style tiles). */
function CreateCard({
  tint,
  iconBg,
  icon: Icon,
  title,
  desc,
  chip,
  onClick,
}: {
  tint: string
  iconBg: string
  icon: typeof QuizIcon
  title: string
  desc: string
  chip?: string
  onClick?: () => void
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex items-start gap-3 rounded-xl border p-4 text-left transition-shadow hover:shadow-md"
      style={{ backgroundColor: tint, borderColor: 'rgba(0,35,65,0.12)' }}
    >
      {chip && (
        <span className="absolute -top-2.5 right-3 rounded-md bg-navy px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cream">
          {chip}
        </span>
      )}
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-cream" style={{ backgroundColor: iconBg }}>
        <Icon size={18} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-navy">{title}</span>
        <span className="mt-0.5 block text-xs leading-4 text-navy/70">{desc}</span>
      </span>
    </button>
  )
}

function SubjectChip({ icon: Icon, label, from, to }: { icon: typeof ScienceIcon; label: string; from: string; to: string }): ReactElement {
  return (
    <button type="button" className="group flex w-20 flex-col items-center gap-2">
      <span
        className="flex h-14 w-14 items-center justify-center rounded-full text-navy transition-transform group-hover:scale-105"
        style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}
      >
        <Icon size={22} />
      </span>
      <span className="text-xs font-medium text-navy/80">{label}</span>
    </button>
  )
}

function ResourceCard({
  icon: Icon,
  preview,
  title,
  desc,
  action,
  onClick,
}: {
  icon: typeof ArticleIcon
  preview: [string, string]
  title: string
  desc: string
  action: string
  onClick: () => void
}): ReactElement {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-cream-100 shadow-2xs transition-shadow hover:shadow-md">
      <div
        className="flex h-32 items-center justify-center border-b border-line"
        style={{ backgroundImage: `linear-gradient(135deg, ${preview[0]}, ${preview[1]})` }}
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-white/70 text-navy shadow-xs">
          <Icon size={26} />
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-4">
        <p className="text-sm font-semibold text-navy">{title}</p>
        <p className="flex-1 text-xs leading-4 text-navy/70">{desc}</p>
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={onClick}
            className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-navy shadow-2xs hover:bg-cream-300"
          >
            {action}
          </button>
        </div>
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: ReactNode }): ReactElement {
  return <h2 className="font-serif text-xl font-semibold text-black/80">{children}</h2>
}

export function DashboardView({ onOpenWizard, onOpenLesson, onOpenGallery }: DashboardProps): ReactElement {
  return (
    <div className="flex h-full bg-cream-100">
      {/* sidebar sits directly on the page background */}
      <aside className="flex w-60 shrink-0 flex-col px-4 pb-4 pt-5">
        <div className="px-2 pb-5">
          <DashLogo />
        </div>
        <nav className="flex flex-col gap-1">
          <NavItem icon={DashboardIcon} label="Dashboard" active />
          <NavItem icon={MenuBookIcon} label="Lesson planning" onClick={onOpenWizard} />
          <NavItem icon={AnalyticsIcon} label="Analytics" />
          <NavItem icon={BotIcon} label="AI tutor" />
          <NavItem icon={LibraryBooksIcon} label="Library" onClick={onOpenLesson} />
          <NavItem icon={HistoryIcon} label="History" />
        </nav>
        <div className="mt-auto flex flex-col gap-1">
          <button
            type="button"
            onClick={onOpenWizard}
            className="mb-2 flex items-center gap-2.5 rounded-lg bg-navy px-3 py-2.5 text-left shadow-xs hover:bg-navy-deep"
          >
            <AutoAwesomeIcon size={16} className="shrink-0 text-brand-purple" />
            <span>
              <span className="block text-xs font-semibold text-cream">Universal Wizard</span>
              <span className="block text-[10px] text-cream/70">Generate a lesson from your sources</span>
            </span>
          </button>
          <NavItem icon={SupportIcon} label="Support" />
          <NavItem icon={FeedbackIcon} label="Leave feedback" />
          <NavItem icon={HelpIcon} label="FAQ" />
          <div className="mt-1 flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-navy/5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-purple text-sm font-semibold text-navy">D</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold leading-4 text-navy">Devanshu</p>
              <p className="truncate text-[10px] leading-3 text-navy/60">devanshu@collage-ai.com</p>
            </div>
            <UnfoldIcon size={15} className="text-navy/60" />
          </div>
        </div>
      </aside>

      {/* floating canvas */}
      <main className="min-h-0 flex-1 overflow-y-auto py-3 pr-3">
        <div className="min-h-full rounded-2xl border border-line bg-page px-8 py-8 shadow-xs">
          {/* hero */}
          <div className="rounded-xl border border-line bg-cream-300 p-6 shadow-2xs">
            <div className="flex items-center justify-between">
              <h1 className="font-serif text-3xl font-semibold text-black/80">What do you want to create?</h1>
              <span className="flex items-center gap-1.5 text-xs font-medium text-navy/70">
                <SchoolIcon size={15} /> Collage Academy
              </span>
            </div>
            <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-[1.2fr_1fr_1fr]">
              <button
                type="button"
                onClick={onOpenWizard}
                className="relative row-span-2 flex flex-col items-start gap-3 rounded-xl border p-5 text-left transition-shadow hover:shadow-md"
                style={{ backgroundColor: 'rgba(220,162,253,0.16)', borderColor: '#dca2fd' }}
              >
                <span className="absolute -top-2.5 right-4 rounded-md bg-navy px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cream">
                  15 blocks
                </span>
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-navy text-cream">
                  <MenuBookIcon size={22} />
                </span>
                <span>
                  <span className="block font-serif text-xl font-semibold text-black/80">Lesson</span>
                  <span className="mt-1 block text-xs leading-5 text-navy/70">
                    Create a full inline lesson — concepts, media, equations, and exercises — guided by the Universal
                    Wizard or built block by block with the slash menu.
                  </span>
                </span>
                <span className="mt-auto flex items-center gap-1.5 rounded-lg bg-navy px-3 py-1.5 text-xs font-medium text-cream">
                  <AutoAwesomeIcon size={14} /> Start with the Wizard
                </span>
              </button>
              <CreateCard
                tint="#d5efff"
                iconBg="#0382ed"
                icon={QuizIcon}
                title="Assessments"
                desc="Checks for understanding with 4 question types and AI feedback."
                chip="New"
                onClick={onOpenLesson}
              />
              <CreateCard
                tint="rgba(173,221,192,0.45)"
                iconBg="#15803d"
                icon={StyleIcon}
                title="Flashcards"
                desc="Flip decks with images, char limits, and student practice mode."
                onClick={onOpenLesson}
              />
              <CreateCard
                tint="rgba(246,206,231,0.5)"
                iconBg="#9405e6"
                icon={AccountTreeIcon}
                title="Mind maps"
                desc="Visual organizers that help students plan, sort, and connect ideas."
                chip="Popular"
                onClick={onOpenLesson}
              />
              <CreateCard
                tint="rgba(255,231,112,0.35)"
                iconBg="#b45309"
                icon={ChecklistIcon}
                title="Worksheets"
                desc="Practice, review, and skill-building sheets from your source PDFs."
                onClick={onOpenWizard}
              />
            </div>
          </div>

          {/* subjects */}
          <div className="mt-8">
            <SectionTitle>Subject essentials</SectionTitle>
            <div className="mt-4 flex flex-wrap gap-4">
              <SubjectChip icon={ScienceIcon} label="Chemistry" from="#d5efff" to="#a2c5fd" />
              <SubjectChip icon={BiotechIcon} label="Biology" from="#adddc0" to="#a2fdc5" />
              <SubjectChip icon={FunctionsIcon} label="Math" from="#ffe770" to="#efdfad" />
              <SubjectChip icon={MenuBookIcon} label="ELA" from="#f6cee7" to="#dca2fd" />
              <SubjectChip icon={PublicIcon} label="Social studies" from="#fdd7a2" to="#fda2a2" />
              <SubjectChip icon={RecordVoiceIcon} label="Speech" from="#dca2fd" to="#a2c5fd" />
              <SubjectChip icon={CodeIcon} label="CS" from="#c2e5ff" to="#7db9ff" />
              <SubjectChip icon={PaletteIcon} label="Arts" from="#f6cee7" to="#ffc9d7" />
            </div>
          </div>

          {/* featured */}
          <div className="mt-8">
            <SectionTitle>Featured in your workspace</SectionTitle>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <ResourceCard
                icon={ArticleIcon}
                preview={['#d5efff', '#a2c5fd']}
                title="States of Matter — preset lesson"
                desc="The full demo lesson with every block: cards, media, equation, graph, table, flashcards, and all four question types."
                action="Open in editor"
                onClick={onOpenLesson}
              />
              <ResourceCard
                icon={AutoAwesomeIcon}
                preview={['#f6cee7', '#dca2fd']}
                title="Universal Wizard"
                desc="Upload source PDFs and co-create objectives, concepts, and a lesson scaffold with the guide chat."
                action="Start wizard"
                onClick={onOpenWizard}
              />
              <ResourceCard
                icon={AutoAwesomeIcon}
                preview={['#adddc0', '#a2fdc5']}
                title="Generative designs"
                desc="Every block's empty, lazy-load, and modify states — the full generation vocabulary in one gallery."
                action="View gallery"
                onClick={() => onOpenGallery('generative')}
              />
              <ResourceCard
                icon={ErrorIcon}
                preview={['#fdd7a2', '#fda2a2']}
                title="Errors & edge cases"
                desc="The complete error catalogue: failures, 404s, validation, upload errors, and student feedback states."
                action="View gallery"
                onClick={() => onOpenGallery('errors')}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
