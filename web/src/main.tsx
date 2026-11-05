import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { type Meta, useApi } from './api';
import { Layout } from './components/Layout';
import { MetaContext, ToastProvider } from './components/ui';
import { CampaignPage } from './pages/Campaign';
import { CampaignsPage } from './pages/Campaigns';
import { CompaniesPage } from './pages/Companies';
import { ConciliationPage } from './pages/Conciliation';
import { FollowUpsPage } from './pages/FollowUps';
import { LeadsPage } from './pages/Leads';
import { PersonalizePage } from './pages/Personalize';
import { ProspectPage } from './pages/Prospect';
import { RepliesPage } from './pages/Replies';
import { ReportPage } from './pages/Report';
import { ReviewPage } from './pages/Review';
import { SendPage } from './pages/Send';
import { SettingsPage } from './pages/Settings';
import { SuppressionsPage } from './pages/Suppressions';
import { WhatsappPage } from './pages/Whatsapp';
import { CompanyPage } from './pages/Company';
import { DuplicatesPage } from './pages/Duplicates';
import { RegisterPage } from './pages/Register';
import { TodayPage } from './pages/Today';
import { match, RouterProvider, useLocation } from './router';
import './styles.css';

const Routes = () => {
  const { path } = useLocation();
  const clean = path.replace(/\/+$/, '') || '/';
  if (clean === '/') return <TodayPage />;
  if (clean === '/empresas') return <CompaniesPage />;
  if (clean === '/empresas/nova') return <RegisterPage />;
  if (clean === '/empresas/duplicadas') return <DuplicatesPage />;
  const company = match('/empresas/:ref', clean);
  if (company) return <CompanyPage key={company.ref} refParam={company.ref!} />;
  const SIMPLE: Record<string, () => React.ReactElement> = {
    '/leads': LeadsPage,
    '/whatsapp': WhatsappPage,
    '/descoberta': ProspectPage,
    '/prospeccao': ProspectPage,
    '/campanhas': CampaignsPage,
    '/revisao': ReviewPage,
    '/envio': SendPage,
    '/conciliacao': ConciliationPage,
    '/followups': FollowUpsPage,
    '/respostas': RepliesPage,
    '/relatorio': ReportPage,
    '/supressoes': SuppressionsPage,
    '/configuracoes': SettingsPage,
  };
  const Page = SIMPLE[clean];
  if (Page) return <Page />;
  const personalize = match('/campanhas/:name/personalizar/:domain', clean);
  if (personalize) return <PersonalizePage key={clean} name={personalize.name!} domain={personalize.domain!} />;
  const campaign = match('/campanhas/:name', clean);
  if (campaign) return <CampaignPage key={campaign.name} name={campaign.name!} />;
  return <div className="bn am">Página não encontrada.</div>;
};

const App = () => {
  const meta = useApi<Meta>('/api/meta');
  return (
    <MetaContext.Provider value={meta}>
      <ToastProvider>
        <Layout>{meta.data ? <Routes /> : null}</Layout>
      </ToastProvider>
    </MetaContext.Provider>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider>
      <App />
    </RouterProvider>
  </StrictMode>,
);
