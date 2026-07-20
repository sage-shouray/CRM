import React, { useState, useEffect } from 'react';
import './ToDo.css';
import axios from 'axios';
import LeadDetails from '../Leads/LeadDetails';

const ToDoInputForm = () => {
  const [filters, setFilters] = useState({
    companyName: '',
    cityName: '',
    vertical: '',
    priority: '',
    contractExpiry: '',
    supportPartner: '',
    turnOver: '',
    leadType: '',
    team: '',
    allLeads: 'all'
  });
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [user, setUser] = useState(null);
  const [selectedLead, setSelectedLead] = useState(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [options, setOptions] = useState({
    verticalOptions: [],
    priorityOptions: [],
    leadAssignedToOptions: [],
    partnerOptions: [],
    expiryOptions: [],
    turnOverOptions: [],
    leadTypeOptions: []
  });

  // Fetch options on component mount
  useEffect(() => {
    const fetchOptions = async () => {
      try {
        const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:4100';
        const [optionsResponse, userNamesResponse] = await Promise.all([
          axios.get(`${API_BASE_URL}/api/options`),
          axios.get(`${API_BASE_URL}/api/users`),
        ]);
        setOptions(prev => ({
          ...prev,
          ...optionsResponse.data,
          leadAssignedToOptions: userNamesResponse.data,
        }));
      } catch (error) {
        console.error("Error fetching options", error);
        setError("Failed to load filter options");
      }
    };
    fetchOptions();
  }, []);

  // Authentication check
  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('token');
      if (token) {
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          setUser(payload);
        } catch (error) {
          console.error('Error decoding token:', error);
          localStorage.removeItem('token');
          setError('Session expired. Please log in again.');
        }
      }
    };
    checkAuth();
  }, []);

  // Real-time search effect
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('Authentication required. Please log in.');
        }

        const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:4100';
        const api = axios.create({
          baseURL: API_BASE_URL,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        const queryParams = Object.entries(filters).reduce((acc, [key, value]) => {
          if (value && value.trim() !== '') {
            acc[key] = value.trim();
          }
          return acc;
        }, {});

        const response = await api.get('/api/leads', {
          params: queryParams,
          timeout: 10000
        });

        setResults(response.data);
      } catch (error) {
        console.error('Error fetching leads:', error);
        
        if (error.response) {
          switch (error.response.status) {
            case 401:
              setError('Please log in to continue.');
              break;
            case 403:
              setError('You do not have permission to access this resource.');
              break;
            default:
              setError(error.response.data.message || 
                      `Server error (${error.response.status}): Please try again later`);
          }
        } else if (error.request) {
          setError('Unable to reach the server. Please check your connection.');
        } else {
          setError(error.message || 'An unexpected error occurred');
        }
        
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    };

    const timeoutId = setTimeout(() => {
      fetchData();
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [filters, refreshTrigger]);

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleReset = () => {
    setFilters({
      companyName: '',
      cityName: '',
      vertical: '',
      priority: '',
      contractExpiry: '',
      supportPartner: '',
      turnOver: '',
      leadType: '',
      team: '',
      allLeads: 'all'
    });
    setResults([]);
  };

  const handleNextActionChange = async (e, leadNumber, index) => {
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Authentication required');
  
      const updateData = {
        companyInfo: {
          nextAction: e.target.value
        }
      };
  
      const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:4100';
      const response = await axios.put(
        `${API_BASE_URL}/api/leads/${leadNumber}`,
        updateData,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );
  
      if (response.data) {
        setResults(prevResults => {
          const newResults = [...prevResults];
          newResults[index] = {
            ...newResults[index],
            companyInfo: {
              ...newResults[index].companyInfo,
              nextAction: e.target.value
            }
          };
          return newResults;
        });
      }
    } catch (error) {
      console.error('API Error:', {
        error: error.response?.data || error.message,
        status: error.response?.status,
        method: 'PUT',
        url: `/api/leads/${leadNumber}`,
      });
      
      let errorMessage = 'Failed to update next action. Please try again.';
      
      if (error.response?.status === 400) {
        errorMessage = 'Invalid lead number format. Please contact support if this persists.';
      } else if (error.response?.status === 401) {
        errorMessage = 'Your session has expired. Please log in again.';
        localStorage.removeItem('token');
      } else if (error.response?.status === 403) {
        errorMessage = 'You do not have permission to update this lead.';
      } else if (error.response?.status === 404) {
        errorMessage = 'Lead not found. It may have been deleted or moved.';
      } else if (!error.response) {
        errorMessage = 'Network error. Please check your connection.';
      }
      
      setError(errorMessage);
    }
  };

  const handleLeadClick = (leadNumber) => {
    setSelectedLead(leadNumber);
  };

  const handleCloseDetails = () => {
    setSelectedLead(null);
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleLeadUpdate = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  const renderResultsTable = () => (
    <table>
      <thead>
        <tr>
          <th>Lead Number</th>
          <th>Generation Date</th>
          <th>Company Name</th>
          <th>Created By</th>
          <th>Assign To</th>
          <th>Phone</th>
          <th>Priority</th>
          <th>Next Action</th>
        </tr>
      </thead>
      <tbody>
        {results.map((result, index) => (
          <tr key={result.leadNumber}>
            <td>
              <button
                className="display-button"
                onClick={() => handleLeadClick(result.leadNumber)}
              >
                {result.leadNumber}
              </button>
            </td>
            <td>{new Date(result.createdAt).toLocaleDateString()}</td>
            <td>{result.companyInfo?.companyName || 'N/A'}</td>
            <td>{`${result.createdBy?.firstName || ''} ${result.createdBy?.lastName || ''}`}</td>
            <td>{`${result.companyInfo?.leadAssignedTo?.firstName || ''} ${result.companyInfo?.leadAssignedTo?.lastName || ''}`}</td>
            <td>{result.companyInfo?.genericPhone1 || 'N/A'}</td>
            <td>{result.companyInfo?.priority || 'N/A'}</td>
            <td>
              <select
                value={result.companyInfo?.nextAction || ''}
                className="clallbtn"
                onChange={(e) => handleNextActionChange(e, result.leadNumber, index)} 
              >
                <option value="">Select Action</option>
                <option value="Call Back">Call Back</option>
                <option value="Follow Up">Follow Up</option>
                <option value="Event">Event</option>
                <option value="Close Lead">Close Lead</option>
              </select>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="container">
      <h2 className="title">TO DO LIST</h2>
      
      {error && (
        <div className="error-message" style={{ color: 'red', margin: '10px 0' }}>
          {error}
        </div>
      )}

      <div className="filters">
        <input
          type="text"
          name="companyName"
          placeholder="Company Name"
          value={filters.companyName}
          onChange={handleFilterChange}
          className="filter-input"
        />
        
        <input
          type="text"
          name="cityName"
          placeholder="City"
          value={filters.cityName}
          onChange={handleFilterChange}
          className="filter-input"
        />

        <select
          name="vertical"
          value={filters.vertical}
          onChange={handleFilterChange}
          className="filter-select"
        >
          <option value="">All Verticals</option>
          {options.verticalOptions.map(option => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>

        <select
          name="priority"
          value={filters.priority}
          onChange={handleFilterChange}
          className="filter-select"
        >
          <option value="">All Priorities</option>
          {options.priorityOptions.map(option => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>

        <select
          name="contractExpiry"
          value={filters.contractExpiry}
          onChange={handleFilterChange}
          className="filter-select"
        >
          <option value="">Expiry Dates</option>
          {options.expiryOptions.map(option => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>

        <select
          name="supportPartner"
          value={filters.supportPartner}
          onChange={handleFilterChange}
          className="filter-select"
        >
          <option value="">All Support Partners</option>
          {options.partnerOptions.map(option => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>

        <select
          name="turnOver"
          value={filters.turnOver}
          onChange={handleFilterChange}
          className="filter-select"
        >
          <option value="">All Turnover Ranges</option>
          {options.turnOverOptions.map(option => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>

        <select
          name="leadType"
          value={filters.leadType}
          onChange={handleFilterChange}
          className="filter-select"
        >
          <option value="">All Lead Types</option>
          {options.leadTypeOptions.map(option => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>

        <select
          name="allLeads"
          value={filters.allLeads}
          onChange={handleFilterChange}
          className="filter-select"
        >
          <option value="all">All Leads</option>
          <option value="createdByMe">My added Leads</option>
          <option value="assignedToMe">My Assign leads</option>
        </select>

        <button 
          type="button" 
          className="btn reset" 
          onClick={handleReset}
          disabled={isLoading}
        >
          Reset
        </button>
      </div>

      <div className="results">
        {isLoading ? (
          <div className="loading">Loading...</div>
        ) : results.length > 0 ? (
          <>
            <h3>Total Leads: {results.length}</h3>
            {renderResultsTable()}
          </>
        ) : (
          <div className="no-results">
            <p>No results found. Please try different filters.</p>
          </div>
        )}
      </div>

      {selectedLead && (
        <LeadDetails
          leadNumber={selectedLead}
          onClose={handleCloseDetails}
          onUpdate={handleLeadUpdate}
        />
      )}
    </div>
  );
};

export default ToDoInputForm;