import { useEffect, useState } from 'react';
import './App.css';

interface HealthResponse {
  status: string;
  database: string;
}

function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
        const response = await fetch(`${apiUrl}/health`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        setHealth(data);
      } catch (e: unknown) {
        if (e instanceof Error) {
          setError(e.message || 'Error fetching health status');
        } else {
          setError('An unexpected error occurred');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchHealth();
  }, []);

  return (
    <div className="App">
      <h1>BCKL Thương Mại Điện Tử</h1>
      <div className="status-box">
        <h2>System Status</h2>
        {loading && <p>Loading backend status...</p>}
        {error && <p style={{ color: 'red' }}>Error: {error}</p>}
        {health && (
          <ul>
            <li>Backend: <strong>{health.status}</strong></li>
            <li>Database: <strong>{health.database}</strong></li>
          </ul>
        )}
      </div>
    </div>
  );
}

export default App;
