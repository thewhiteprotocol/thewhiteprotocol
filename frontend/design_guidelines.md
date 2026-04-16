# pSol Protocol - Design Guidelines

## Design Approach
**Reference-Based**: Privacy/Protocol-focused design inspired by professional crypto protocols (Aave, Uniswap, Compound) with dark themes and technical precision. Combines protocol sophistication with developer-friendly clarity.

## Visual Identity
- **Theme**: Dark theme with cyan/teal (#06b6d4 or similar) as primary accent color for "pSol" branding
- **Tone**: Professional, clean, protocol-style - no memes, no emojis, pure technical focus
- **Logo Integration**: Use provided pSol logo prominently in navbar and as favicon

## Typography System
- **Headings**: Bold, technical sans-serif hierarchy
  - H1: text-4xl md:text-5xl font-bold (Hero title)
  - H2: text-3xl md:text-4xl font-bold (Section headers)
  - H3: text-xl md:text-2xl font-semibold (Subsections)
- **Body**: text-base md:text-lg leading-relaxed for readability
- **Code/Technical**: monospace font for program IDs, code snippets

## Layout System
- **Spacing**: Primary units of 4, 8, 16, 24 (p-4, py-8, my-16, py-24)
- **Container**: max-w-6xl mx-auto px-6 for all sections
- **Section Padding**: py-16 md:py-24 for vertical rhythm
- **Single-Column**: Central alignment, no multi-column text blocks for easy reading/copying

## Navigation
- **Sticky Navbar**: Fixed top, dark background with slight transparency/blur
- **Links**: Overview, Architecture, Docs, Devnet, Roadmap, Links
- **Logo**: pSol logo on left, navigation items centered or right
- **Smooth Scroll**: Programmatic scroll behavior to section IDs

## Component Library

### Hero Section
- Large pSol logo/wordmark prominently displayed
- Title: "pSol Protocol – Private Liquidity on Solana"
- Concise 1-2 line subtitle explaining privacy pool concept
- Status badge: "Phase 3 complete – deployed on Solana devnet" (bordered, cyan accent)
- Primary CTAs: "Read the docs" (solid cyan), "View on GitHub" (outline)
- Social: Small Twitter/X link with icon
- Background: Subtle gradient or mesh pattern (dark blues/teals)

### Architecture Section
- Clean text-based layout with structured content
- Use bordered cards/panels (border-gray-800) for key feature blocks
- Technical bullet points with subtle left border accent
- Code snippets in dark code blocks with syntax-appropriate styling

### Documentation Section
- Accordion or tab-based subsections: Getting Started, Program Overview, Devnet Deployment, CLI Interaction
- Command snippets in monospace with copy-to-clipboard functionality
- Clear placeholder: "Program ID: <REPLACE_WITH_DEVNET_PROGRAM_ID>" in highlighted box
- Step-by-step instruction blocks with numbered/bulleted lists

### Devnet Status Section
- Connection status display with network badge
- Wallet Adapter integration: Multi-wallet button (Phantom, Solflare, etc.)
- Connected state: Show public key (truncated), connection indicator
- Info cards showing: Network (devnet), Program name, Program ID placeholder
- Clean, dashboard-like presentation

### Roadmap Section
- Vertical timeline or phased card layout
- 5 phases clearly separated with phase numbers and titles
- Current phase (Phase 3) highlighted with cyan border/accent
- Each phase: Title, concise 2-3 bullet description
- Visual progression indicators (checkmarks for completed, current marker)

### Links Section
- Large, prominent button grid (2-column on desktop)
- GitHub and Twitter/X buttons with respective brand colors/icons
- Placeholder for future documentation site

## Interactive Elements
- **Buttons**: Rounded corners (rounded-lg), hover states with brightness increase
- **Cards**: Subtle border (border-gray-800), hover effect with slight glow
- **Wallet Connect**: Solana Wallet Adapter modal styling (dark theme)
- **Smooth Transitions**: 200-300ms for hover states

## Images
- **Logo**: pSol logo used in navbar (height h-8 to h-10)
- **Favicon**: Convert pSol logo to multi-size favicon
- **Hero Background**: Optional subtle geometric pattern or gradient mesh (dark teal/cyan tones)
- **No Stock Photos**: Technical protocol site - keep visual focus on typography and data

## Accessibility
- Clear contrast ratios on dark background (text-gray-100 for body, text-white for headings)
- Focus states on all interactive elements
- Semantic HTML structure
- ARIA labels for wallet connection states

## Responsive Behavior
- Mobile: Single column, stacked navigation in hamburger menu
- Tablet: Maintain single-column content, adjust spacing
- Desktop: Full navigation bar, optimal reading width (max-w-6xl)
- Breakpoints: sm, md, lg, xl as needed

## Technical Constraints
- Frontend-only SPA, no backend dependencies
- Devnet RPC endpoint: https://api.devnet.solana.com
- All content static, no dynamic data fetching (for now)
- Clear placeholders for future integration points (SDK, program ID, interactive flows)