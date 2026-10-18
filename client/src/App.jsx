import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from './routes';
import { AuthProvider } from './context';
import { AuthModal } from './components/auth';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
        <AuthModal />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;

