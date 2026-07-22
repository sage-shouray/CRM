import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import axios from "axios";
import { Country, State, City } from "country-state-city";
import "./CreateLeads.css";
import {
  companyFormConfig,
  contactFormConfig,
  itLandscapeConfig,
} from "./formConfigs";

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:4100';

const FormRow = ({ children }) => <div className="form-row">{children}</div>;

const FormGroup = ({
  field,
  formData,
  handleChange,
  errors,
  options,
  countryList = [],
  stateList = [],
  cityList = [],
  onCountrySelect,
  onStateSelect,
  onCitySelect,
}) => {
  const isPrimary = field.isPrimary;
  const isCountry = field.isCascadingCountry;
  const isState = field.isCascadingState;
  const isCity = field.isCascadingCity;

  return (
    <div className={`form-group ${isPrimary ? "primary-company-field full-width" : ""}`}>
      <label htmlFor={field.name}>
        {field.label}: {field.required && <span className="req-star">*</span>}
      </label>

      {isCountry ? (
        <select
          name={field.name}
          value={formData[field.name] || ""}
          onChange={onCountrySelect || handleChange}
          className={`cascading-select ${errors[field.name] ? "mandatory" : ""}`}
        >
          <option value="">Select Country</option>
          {countryList.map((c) => (
            <option key={c.isoCode} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      ) : isState ? (
        <select
          name={field.name}
          value={formData[field.name] || ""}
          onChange={onStateSelect || handleChange}
          disabled={!formData.country}
          className={`cascading-select ${errors[field.name] ? "mandatory" : ""}`}
        >
          <option value="">
            {!formData.country ? "Select Country First" : "Select State"}
          </option>
          {stateList.map((s) => (
            <option key={s.isoCode} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
      ) : isCity ? (
        cityList.length > 0 ? (
          <select
            name={field.name}
            value={formData[field.name] || ""}
            onChange={onCitySelect || handleChange}
            disabled={!formData.state}
            className={`cascading-select ${errors[field.name] ? "mandatory" : ""}`}
          >
            <option value="">
              {!formData.state ? "Select State First" : "Select City"}
            </option>
            {cityList.map((ct, idx) => (
              <option key={`${ct.name}-${idx}`} value={ct.name}>
                {ct.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            id={field.name}
            name={field.name}
            placeholder={!formData.state ? "Select State First" : "Enter City"}
            value={formData[field.name] || ""}
            onChange={handleChange}
            disabled={!formData.state}
            className={errors[field.name] ? "mandatory" : ""}
          />
        )
      ) : field.type === "select" ? (
        <div className="select-with-date">
          <select
            name={field.name}
            value={formData[field.name] || ""}
            onChange={handleChange}
            className={errors[field.name] ? "mandatory" : ""}
          >
            <option value="">Select {field.label}</option>
            {options[field.options]?.map((option, index) => (
              <option key={index} value={option._id || option}>
                {typeof option === "object" && option.firstName && option.lastName
                  ? `${option.firstName} ${option.lastName}`
                  : option}
              </option>
            ))}
          </select>
          {field.datePicker && (
            <input
              type="date"
              name={field.datePicker.name}
              value={formData[field.datePicker.name] || ""}
              onChange={handleChange}
              onClick={(e) => e.target.showPicker?.()}
              className={errors[field.datePicker.name] ? "mandatory" : ""}
              title="Click to select date from calendar"
            />
          )}
        </div>
      ) : field.type === "date" ? (
        <input
          type="date"
          id={field.name}
          name={field.name}
          value={formData[field.name] || ""}
          onChange={handleChange}
          onClick={(e) => e.target.showPicker?.()}
          className={errors[field.name] ? "mandatory" : ""}
          title="Click to select date from calendar"
        />
      ) : (
        <input
          type={field.type}
          id={field.name}
          name={field.name}
          value={formData[field.name] || ""}
          onChange={handleChange}
          placeholder={isPrimary ? "Enter Company Name (Primary Field)..." : ""}
          className={`${isPrimary ? "primary-input" : ""} ${errors[field.name] ? "mandatory" : ""}`}
        />
      )}
      {errors[field.name] && <span className="error">{errors[field.name]}</span>}
      {field.datePicker && errors[field.datePicker.name] && (
        <span className="error">{errors[field.datePicker.name]}</span>
      )}
    </div>
  );
};

const CreateLeads = () => {
  const [userId, setUserId] = useState(null);
  const [formData, setFormData] = useState({
    company: {},
    contact: {},
    additionalSections: [],
    itLandscape: {
      netNew: {},
      SAPInstalledBase: {},
    },
    description: "",
    selectedOption: "",
    radioValue: "",
    createdBy: "",
  });
  const [errors, setErrors] = useState({});
  const [options, setOptions] = useState({});
  const [file, setFile] = useState(null);
  const fileInputRef = useRef(null);

  // Alphabetically sorted Countries list worldwide
  const allCountries = useMemo(() => {
    return Country.getAllCountries().sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  // Selected Country Object
  const selectedCountryObj = useMemo(() => {
    if (!formData.company?.country) return null;
    return allCountries.find((c) => c.name === formData.company.country);
  }, [allCountries, formData.company?.country]);

  // Alphabetically sorted States list for selected Country
  const availableStates = useMemo(() => {
    if (!selectedCountryObj) return [];
    return State.getStatesOfCountry(selectedCountryObj.isoCode).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [selectedCountryObj]);

  // Selected State Object
  const selectedStateObj = useMemo(() => {
    if (!formData.company?.state || !selectedCountryObj) return null;
    return availableStates.find((s) => s.name === formData.company.state);
  }, [availableStates, formData.company?.state, selectedCountryObj]);

  // Alphabetically sorted Cities list for selected State
  const availableCities = useMemo(() => {
    if (!selectedCountryObj || !selectedStateObj) return [];
    return City.getCitiesOfState(
      selectedCountryObj.isoCode,
      selectedStateObj.isoCode
    ).sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedCountryObj, selectedStateObj]);

  useEffect(() => {
    const fetchOptions = async () => {
      try {
        const [optionsResponse, userNamesResponse] = await Promise.all([
          axios.get(`${API_BASE_URL}/api/options`),
          axios.get(`${API_BASE_URL}/api/users`),
        ]);
        const userNames = userNamesResponse.data.map(user => user.firstName);
        setOptions((prevOptions) => ({
          ...prevOptions,
          ...optionsResponse.data,
          leadTypeOptions: ["Net New", "SAP Installed Base"],
          bdmOptions: userNames,
          leadAssignedToOptions: userNames,
        }));
      } catch (error) {
        console.error("Error fetching options", error);
      }
    };
    fetchOptions();
  }, []);

  useEffect(() => {
    const userIdFromStorage = localStorage.getItem("userId");
    if (userIdFromStorage) {
      setUserId(userIdFromStorage);
      setFormData((prevData) => ({
        ...prevData,
        createdBy: userIdFromStorage,
      }));
    }
  }, []);

  const handleChange = useCallback((e, section, index) => {
    const { name, value } = e.target;
    const parsedValue = ["totalNoOfOffices", "totalNoOfManufUnits"].includes(
      name
    )
      ? Number(value)
      : value;

    setFormData((prevData) => {
      if (section === "additionalSections") {
        const newAdditionalSections = [...prevData.additionalSections];
        if (!newAdditionalSections[index]) {
          newAdditionalSections[index] = {};
        }
        newAdditionalSections[index][name] = value;
        return { ...prevData, additionalSections: newAdditionalSections };
      } else if (section === "itLandscape") {
        return {
          ...prevData,
          itLandscape: {
            ...prevData.itLandscape,
            [index]: { ...prevData.itLandscape[index], [name]: value },
          },
        };
      } else if (section) {
        return {
          ...prevData,
          [section]: { ...prevData[section], [name]: parsedValue },
        };
      } else {
        return { ...prevData, [name]: value };
      }
    });
    setErrors((prevErrors) => ({ ...prevErrors, [name]: "" }));
  }, []);

  // Cascading Location Select Handlers
  const handleCountrySelect = (e) => {
    const countryName = e.target.value;
    setFormData((prev) => ({
      ...prev,
      company: {
        ...prev.company,
        country: countryName,
        state: "",
        city: "",
      },
    }));
    setErrors((prevErrors) => ({ ...prevErrors, country: "", state: "", city: "" }));
  };

  const handleStateSelect = (e) => {
    const stateName = e.target.value;
    setFormData((prev) => ({
      ...prev,
      company: {
        ...prev.company,
        state: stateName,
        city: "",
      },
    }));
    setErrors((prevErrors) => ({ ...prevErrors, state: "", city: "" }));
  };

  const handleCitySelect = (e) => {
    const cityName = e.target.value;
    setFormData((prev) => ({
      ...prev,
      company: {
        ...prev.company,
        city: cityName,
      },
    }));
    setErrors((prevErrors) => ({ ...prevErrors, city: "" }));
  };

  const addSection = useCallback(() => {
    setFormData((prevData) => ({
      ...prevData,
      additionalSections: [
        ...prevData.additionalSections,
        { sectionTitle: `Other Contact Person ${prevData.additionalSections.length + 1}` },
      ],
    }));
  }, []);

  const removeSection = useCallback((indexToRemove) => {
    setFormData((prevData) => ({
      ...prevData,
      additionalSections: prevData.additionalSections.filter((_, idx) => idx !== indexToRemove),
    }));
  }, []);

  const handleSectionTitleChange = useCallback((indexToUpdate, newTitle) => {
    setFormData((prevData) => {
      const updated = [...prevData.additionalSections];
      updated[indexToUpdate] = {
        ...updated[indexToUpdate],
        sectionTitle: newTitle,
      };
      return { ...prevData, additionalSections: updated };
    });
  }, []);

  const resetForm = useCallback(() => {
    setFormData({
      company: {},
      contact: {},
      additionalSections: [],
      itLandscape: {
        netNew: {},
        SAPInstalledBase: {},
      },
      description: "",
      selectedOption: "",
      radioValue: "",
    });
    setFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setErrors({});
  }, []);

  const validateForm = useCallback(() => {
    const newErrors = {};
    const validateSection = (config, data, section) => {
      config.flat().forEach((field) => {
        if (field.required && !data[field.name]?.toString().trim()) {
          newErrors[field.name] = `${field.label} is required`;
        }
        if (field.datePicker?.required && !data[field.datePicker.name]) {
          newErrors[
            field.datePicker.name
          ] = `${field.datePicker.label} is required`;
        }
      });
    };

    validateSection(companyFormConfig, formData.company, "company");
    contactFormConfig.forEach((role) => {
      validateSection(role.fields, formData.contact, "contact");
    });
    Object.entries(itLandscapeConfig).forEach(([section, fields]) => {
      const selectedType = formData.company?.leadType;
      if (selectedType === "Net New" && section !== "netNew") return;
      if (selectedType === "SAP Installed Base" && section !== "SAPInstalledBase") return;

      validateSection(
        fields,
        formData.itLandscape[section],
        `itLandscape.${section}`
      );
    });

    if (!formData.description.trim())
      newErrors.description = "Description is required";
    if (!file) newErrors.file = "File is required";
    if (!formData.selectedOption)
      newErrors.selectedOption = "Present Conversation Level is required";
    if (!formData.radioValue)
      newErrors.radioValue = "Mailer Shared selection is required";

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData, file]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (validateForm()) {
      try {
        const formDataToSend = new FormData();
        const dataToSend = {
          ...formData,
          createdBy: userId || null,
          company: {
            ...formData.company,
            leadNumber: formData.company.leadNumber
              ? parseInt(formData.company.leadNumber, 10)
              : undefined,
          },
        };
        formDataToSend.append("data", JSON.stringify(dataToSend));
        if (file) {
          formDataToSend.append("file", file);
        }

        const response = await axios.post(
          `${API_BASE_URL}/api/leads`,
          formDataToSend,
          {
            headers: { "Content-Type": "multipart/form-data" },
          }
        );

        alert(
          `Lead created successfully! Lead Number: ${response.data.leadNumber}`
        );
        resetForm();
      } catch (error) {
        console.error("Error saving data", error);
        alert("Error saving data. Please try again.");
      }
    }
  };

  return (
    <div className="create-leads-container">
      <form onSubmit={handleSubmit}>
        <section className="form-section">
          <div className="section-header-box">
            <h1>Company Information</h1>
            <p className="section-subtext">Enter primary company details and location hierarchy</p>
          </div>

          {companyFormConfig.map((row, rowIndex) => (
            <FormRow key={rowIndex}>
              {row.map((field) => (
                <FormGroup
                  key={field.name}
                  field={field}
                  formData={formData.company}
                  handleChange={(e) => handleChange(e, "company")}
                  errors={errors}
                  options={options}
                  countryList={allCountries}
                  stateList={availableStates}
                  cityList={availableCities}
                  onCountrySelect={handleCountrySelect}
                  onStateSelect={handleStateSelect}
                  onCitySelect={handleCitySelect}
                />
              ))}
            </FormRow>
          ))}
        </section>

        <section className="form-section">
          <div className="section-header-box">
            <h1>Contact Information</h1>
          </div>
          {contactFormConfig.map((role, roleIndex) => (
            <div key={roleIndex} className="contact-role-block">
              <h2>{role.role} Contact</h2>
              {role.fields
                .reduce((rows, field, index) => {
                  const rowIndex = Math.floor(index / 3);
                  if (!rows[rowIndex]) {
                    rows[rowIndex] = [];
                  }
                  rows[rowIndex].push(
                    <FormGroup
                      key={field.name}
                      field={field}
                      formData={formData.contact}
                      handleChange={(e) => handleChange(e, "contact")}
                      errors={errors}
                      options={options}
                    />
                  );
                  return rows;
                }, [])
                .map((row, rowIndex) => (
                  <FormRow key={rowIndex}>{row}</FormRow>
                ))}
            </div>
          ))}

          {formData.additionalSections.map((section, index) => (
            <div key={`other-section-${index}`} className="contact-role-block editable-contact-block">
              <div className="section-header-action-row">
                <div className="section-title-edit-box">
                  <label htmlFor={`section-title-${index}`}>Contact Person Role Title:</label>
                  <input
                    type="text"
                    id={`section-title-${index}`}
                    className="editable-section-title-input"
                    value={section.sectionTitle || `Other Contact Section ${index + 1}`}
                    onChange={(e) => handleSectionTitleChange(index, e.target.value)}
                    placeholder="e.g. Procurement Head, CTO, Operations..."
                  />
                </div>
                <button
                  type="button"
                  className="btn-delete-section"
                  onClick={() => removeSection(index)}
                  title="Delete this contact section"
                >
                  ✕ Remove Section
                </button>
              </div>

              {contactFormConfig[0].fields
                .reduce((rows, field, idx) => {
                  const rowIndex = Math.floor(idx / 3);
                  if (!rows[rowIndex]) {
                    rows[rowIndex] = [];
                  }
                  rows[rowIndex].push(
                    <FormGroup
                      key={`${field.name}_other_${index}`}
                      field={{
                        ...field,
                        name: field.name.replace("it", "").toLowerCase(),
                      }}
                      formData={section}
                      handleChange={(e) =>
                        handleChange(e, "additionalSections", index)
                      }
                      errors={errors}
                      options={options}
                    />
                  );
                  return rows;
                }, [])
                .map((row, rowIndex) => (
                  <FormRow key={rowIndex}>{row}</FormRow>
                ))}
            </div>
          ))}

          <div className="form-row">
            <button type="button" className="add-section" onClick={addSection}>
              + Add Other Contact Section
            </button>
          </div>
        </section>

        <section className="form-section">
          <div className="section-header-box">
            <h1>IT Landscape</h1>
            {formData.company?.leadType && (
              <p className="section-subtext">Configured for <strong>{formData.company.leadType}</strong> Lead Type</p>
            )}
          </div>
          
          {(!formData.company?.leadType || formData.company?.leadType === "Net New") && (
            <div className="landscape-block">
              <h2>Net New</h2>
              {itLandscapeConfig.netNew.map((row, rowIndex) => (
                <FormRow key={`netNew-${rowIndex}`}>
                  {row.map((field) => (
                    <FormGroup
                      key={field.name}
                      field={field}
                      formData={formData.itLandscape.netNew}
                      handleChange={(e) => handleChange(e, "itLandscape", "netNew")}
                      errors={errors}
                      options={options}
                    />
                  ))}
                </FormRow>
              ))}
            </div>
          )}

          {(!formData.company?.leadType || formData.company?.leadType === "SAP Installed Base") && (
            <div className="landscape-block">
              <h2>SAP Installed Base</h2>
              {itLandscapeConfig.SAPInstalledBase.map((row, rowIndex) => (
                <FormRow key={`SAPInstalledBase-${rowIndex}`}>
                  {row.map((field) => (
                    <FormGroup
                      key={field.name}
                      field={field}
                      formData={formData.itLandscape.SAPInstalledBase}
                      handleChange={(e) =>
                        handleChange(e, "itLandscape", "SAPInstalledBase")
                      }
                      errors={errors}
                      options={options}
                    />
                  ))}
                </FormRow>
              ))}
            </div>
          )}
        </section>

        <section className="form-section">
          <div className="section-header-box">
            <h1>Description & Attachments</h1>
          </div>
          
          <div className="form-row">
            <div className="form-group full-width">
              <label htmlFor="description">
                Description: <span className="req-star">*</span>
              </label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={(e) => handleChange(e)}
                required
                rows={4}
                placeholder="Enter key lead conversation notes, requirements, and background information..."
              />
              {errors.description && (
                <span className="error">{errors.description}</span>
              )}
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="file">
                Attachment (PDF or Word): <span className="req-star">*</span>
              </label>
              <input
                type="file"
                id="file"
                name="file"
                accept=".pdf,.doc,.docx"
                onChange={(e) => setFile(e.target.files[0])}
                required
                ref={fileInputRef}
              />
              {errors.file && <span className="error">{errors.file}</span>}
            </div>

            <div className="form-group">
              <label htmlFor="selectedOption">
                Present Conversation Level: <span className="req-star">*</span>
              </label>
              <select
                id="selectedOption"
                name="selectedOption"
                value={formData.selectedOption}
                onChange={(e) => handleChange(e)}
              >
                <option value="">Select an option</option>
                {options.conversationLevelOptions?.map((option, index) => (
                  <option key={index} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              {errors.selectedOption && (
                <span className="error">{errors.selectedOption}</span>
              )}
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Mailer Shared: <span className="req-star">*</span></label>
              <div className="radio-group">
                <label className="radio-label">
                  <input
                    type="radio"
                    name="radioValue"
                    value="yes"
                    checked={formData.radioValue === "yes"}
                    onChange={(e) => handleChange(e)}
                    required
                  />
                  Yes
                </label>
                <label className="radio-label">
                  <input
                    type="radio"
                    name="radioValue"
                    value="no"
                    checked={formData.radioValue === "no"}
                    onChange={(e) => handleChange(e)}
                  />
                  No
                </label>
              </div>
              {errors.radioValue && (
                <span className="error">{errors.radioValue}</span>
              )}
            </div>
          </div>

          <div className="form-row form-submit-row">
            <button type="submit" className="submit btn-create-lead-submit">
              Submit Lead
            </button>
          </div>
        </section>
      </form>
    </div>
  );
};

export default CreateLeads;
