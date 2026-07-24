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
  const isDisabled = field.name === "reason" && formData.leadUsable === "Yes";

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
          disabled={isDisabled}
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
          disabled={isDisabled || !formData.country}
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
            disabled={isDisabled || !formData.state}
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
            disabled={isDisabled || !formData.state}
            className={errors[field.name] ? "mandatory" : ""}
          />
        )
      ) : field.type === "select" ? (
        <>
          <div className="select-with-date">
            <select
              name={field.name}
              value={
                field.name === "vertical" && 
                formData[field.name] && 
                options[field.options] && 
                !options[field.options].includes(formData[field.name])
                  ? "Others"
                  : formData[field.name] || ""
              }
              onChange={(e) => {
                if (field.name === "vertical" && e.target.value === "Others") {
                  handleChange({ target: { name: field.name, value: "Others" } });
                } else {
                  handleChange(e);
                }
              }}
              disabled={isDisabled}
              className={errors[field.name] ? "mandatory" : ""}
            >
              <option value="" disabled>Select {field.label}</option>
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
                disabled={isDisabled}
                className={errors[field.datePicker.name] ? "mandatory" : ""}
                title="Click to select date from calendar"
              />
            )}
          </div>
          {field.name === "vertical" && 
            (formData[field.name] === "Others" || 
             (formData[field.name] && 
              options[field.options] && 
              !options[field.options].includes(formData[field.name]))) && (
            <input
              type="text"
              name="verticalCustom"
              placeholder="Specify custom vertical..."
              value={formData[field.name] === "Others" ? "" : formData[field.name]}
              onChange={(e) => {
                handleChange({ target: { name: field.name, value: e.target.value || "Others" } });
              }}
              disabled={isDisabled}
              className={errors[field.name] ? "mandatory" : ""}
              style={{ marginTop: "6px" }}
            />
          )}
        </>
      ) : field.type === "date" ? (
        <input
          type="date"
          id={field.name}
          name={field.name}
          value={formData[field.name] || ""}
          onChange={handleChange}
          onClick={(e) => e.target.showPicker?.()}
          disabled={isDisabled}
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
          disabled={isDisabled}
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
        const allUsers = userNamesResponse.data || [];
        const bdmNames = allUsers
          .filter(user => (user.designation || "").toUpperCase() === "BDM")
          .map(user => user.firstName);
        const allUserNames = allUsers.map(user => user.firstName);
        setOptions((prevOptions) => ({
          ...prevOptions,
          ...optionsResponse.data,
          leadTypeOptions: ["Net New", "SAP Installed Base"],
          bdmOptions: bdmNames,
          leadAssignedToOptions: allUsers,
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
        const updatedSection = { ...prevData[section], [name]: parsedValue };
        if (section === "company" && name === "leadUsable" && parsedValue === "Yes") {
          updatedSection.reason = "";
        }
        return {
          ...prevData,
          [section]: updatedSection,
        };
      } else {
        return { ...prevData, [name]: value };
      }
    });

    setErrors((prevErrors) => {
      const nextErrors = { ...prevErrors, [name]: "" };
      if (section === "company" && name === "leadUsable" && parsedValue === "Yes") {
        nextErrors.reason = "";
      }
      return nextErrors;
    });
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
        let isRequired = field.required;
        if (section === "company" && field.name === "reason" && formData.company?.leadUsable === "No") {
          isRequired = true;
        }
        if (isRequired && !data[field.name]?.toString().trim()) {
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

              {/* Row 1: Using ERP | Budget | Opportunity */}
              <FormRow>
                <div className="form-group">
                  <label htmlFor="usingERP">Using ERP:</label>
                  <select
                    name="usingERP"
                    id="usingERP"
                    value={formData.itLandscape.netNew?.usingERP || ""}
                    onChange={(e) => handleChange(e, "itLandscape", "netNew")}
                    className={errors.usingERP ? "mandatory" : ""}
                  >
                    <option value="" disabled>Select</option>
                    {options.usingERPOptions?.map((o, i) => <option key={i} value={o}>{o}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="budget">Budget:</label>
                  <input
                    type="text"
                    id="budget"
                    name="budget"
                    value={formData.itLandscape.netNew?.budget || ""}
                    onChange={(e) => handleChange(e, "itLandscape", "netNew")}
                    className={errors.budget ? "mandatory" : ""}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="opportunityForUs1">Opportunity:</label>
                  <select
                    name="opportunityForUs1"
                    id="opportunityForUs1"
                    value={formData.itLandscape.netNew?.opportunityForUs1 || ""}
                    onChange={(e) => handleChange(e, "itLandscape", "netNew")}
                    className={errors.opportunityForUs1 ? "mandatory" : ""}
                  >
                    <option value="" disabled>Select Opportunity</option>
                    {options.opportunityOptions?.map((o, i) => <option key={i} value={o}>{o}</option>)}
                  </select>
                </div>
              </FormRow>

              {/* Conditional: If yes → ERP picker | If no → Why */}
              {formData.itLandscape.netNew?.usingERP === "Yes" && (
                <FormRow>
                  <div className="form-group">
                    <label htmlFor="ifYesWhichOne">If yes, which ERP:</label>
                    <select
                      name="ifYesWhichOne"
                      id="ifYesWhichOne"
                      value={formData.itLandscape.netNew?.ifYesWhichOne || ""}
                      onChange={(e) => handleChange(e, "itLandscape", "netNew")}
                      className={errors.ifYesWhichOne ? "mandatory" : ""}
                    >
                      <option value="" disabled>Select ERP</option>
                      {options.ERPTypeOptions?.map((o, i) => <option key={i} value={o}>{o}</option>)}
                    </select>
                  </div>
                </FormRow>
              )}

              {formData.itLandscape.netNew?.usingERP === "No" && (
                <FormRow>
                  <div className="form-group">
                    <label htmlFor="ifNoWhy">If no, why:</label>
                    <select
                      name="ifNoWhy"
                      id="ifNoWhy"
                      value={formData.itLandscape.netNew?.ifNoWhy || ""}
                      onChange={(e) => handleChange(e, "itLandscape", "netNew")}
                      className={errors.ifNoWhy ? "mandatory" : ""}
                    >
                      <option value="" disabled>Select reason</option>
                      {options.noWhyOptions?.map((o, i) => <option key={i} value={o}>{o}</option>)}
                    </select>
                  </div>
                </FormRow>
              )}

              {/* Row 2: Authority | Opportunity Value (whole numbers only) | Need */}
              <FormRow>
                <div className="form-group">
                  <label htmlFor="authority">Authority:</label>
                  <input
                    type="text"
                    id="authority"
                    name="authority"
                    value={formData.itLandscape.netNew?.authority || ""}
                    onChange={(e) => handleChange(e, "itLandscape", "netNew")}
                    className={errors.authority ? "mandatory" : ""}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="opportunityValue1">Opportunity Value:</label>
                  <input
                    type="text"
                    id="opportunityValue1"
                    name="opportunityValue1"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={formData.itLandscape.netNew?.opportunityValue1 || ""}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^0-9]/g, "");
                      handleChange({ target: { name: "opportunityValue1", value: raw } }, "itLandscape", "netNew");
                    }}
                    placeholder="Enter whole number only"
                    className={errors.opportunityValue1 ? "mandatory" : ""}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="need">Need:</label>
                  <input
                    type="text"
                    id="need"
                    name="need"
                    value={formData.itLandscape.netNew?.need || ""}
                    onChange={(e) => handleChange(e, "itLandscape", "netNew")}
                    className={errors.need ? "mandatory" : ""}
                  />
                </div>
              </FormRow>

              {/* Row 3: Timeframe */}
              <FormRow>
                <div className="form-group">
                  <label htmlFor="timeframe">Timeframe:</label>
                  <select
                    name="timeframe"
                    id="timeframe"
                    value={formData.itLandscape.netNew?.timeframe || ""}
                    onChange={(e) => handleChange(e, "itLandscape", "netNew")}
                    className={errors.timeframe ? "mandatory" : ""}
                  >
                    <option value="" disabled>Select Timeframe</option>
                    {options.timeframeOptions?.map((o, i) => <option key={i} value={o}>{o}</option>)}
                  </select>
                </div>
              </FormRow>
            </div>
          )}

          {(!formData.company?.leadType || formData.company?.leadType === "SAP Installed Base") && (
            <div className="landscape-block">
              <h2>SAP Installed Base</h2>

              {/* Row 1: Opportunity for us available | Year of Implementation | No. of Users */}
              <FormRow>
                <div className="form-group">
                  <label htmlFor="opportunityForUs2">Opportunity for us available:</label>
                  <select
                    name="opportunityForUs2"
                    id="opportunityForUs2"
                    value={formData.itLandscape.SAPInstalledBase?.opportunityForUs2 || ""}
                    onChange={(e) => handleChange(e, "itLandscape", "SAPInstalledBase")}
                    className={errors.opportunityForUs2 ? "mandatory" : ""}
                  >
                    <option value="" disabled>Select</option>
                    {options.opportunityOptions?.map((o, i) => <option key={i} value={o}>{o}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="yearOfImplementation">Year of Implementation:</label>
                  <input
                    type="text"
                    id="yearOfImplementation"
                    name="yearOfImplementation"
                    value={formData.itLandscape.SAPInstalledBase?.yearOfImplementation || ""}
                    onChange={(e) => handleChange(e, "itLandscape", "SAPInstalledBase")}
                    className={errors.yearOfImplementation ? "mandatory" : ""}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="noOfUsers">No. of Users:</label>
                  <input
                    type="number"
                    id="noOfUsers"
                    name="noOfUsers"
                    value={formData.itLandscape.SAPInstalledBase?.noOfUsers || ""}
                    onChange={(e) => handleChange(e, "itLandscape", "SAPInstalledBase")}
                    className={errors.noOfUsers ? "mandatory" : ""}
                  />
                </div>
              </FormRow>

              {/* Row 2: Opportunity Value (numeric only) | Contract Expiry | Support Partner */}
              <FormRow>
                <div className="form-group">
                  <label htmlFor="opportunityValue2">Opportunity Value:</label>
                  <input
                    type="text"
                    id="opportunityValue2"
                    name="opportunityValue2"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={formData.itLandscape.SAPInstalledBase?.opportunityValue2 || ""}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^0-9]/g, "");
                      handleChange({ target: { name: "opportunityValue2", value: raw } }, "itLandscape", "SAPInstalledBase");
                    }}
                    placeholder="Enter whole number only"
                    className={errors.opportunityValue2 ? "mandatory" : ""}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="contractExpiry">Contract Expiry:</label>
                  <select
                    name="contractExpiry"
                    id="contractExpiry"
                    value={formData.itLandscape.SAPInstalledBase?.contractExpiry || ""}
                    onChange={(e) => handleChange(e, "itLandscape", "SAPInstalledBase")}
                    className={errors.contractExpiry ? "mandatory" : ""}
                  >
                    <option value="" disabled>Select</option>
                    {options.expiryOptions?.map((o, i) => <option key={i} value={o}>{o}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="supportPartner">Support Partner:</label>
                  <select
                    name="supportPartner"
                    id="supportPartner"
                    value={formData.itLandscape.SAPInstalledBase?.supportPartner || ""}
                    onChange={(e) => handleChange(e, "itLandscape", "SAPInstalledBase")}
                    className={errors.supportPartner ? "mandatory" : ""}
                  >
                    <option value="" disabled>Select</option>
                    {options.partnerOptions?.map((o, i) => <option key={i} value={o}>{o}</option>)}
                  </select>
                </div>
              </FormRow>

              {/* Row 3: Opportunity for (custom dropdown) | Exact Version | Hardware */}
              <FormRow>
                <div className="form-group">
                  <label htmlFor="opportunityForUs3">Opportunity for:</label>
                  <select
                    name="opportunityForUs3"
                    id="opportunityForUs3"
                    value={formData.itLandscape.SAPInstalledBase?.opportunityForUs3 || ""}
                    onChange={(e) => handleChange(e, "itLandscape", "SAPInstalledBase")}
                    className={errors.opportunityForUs3 ? "mandatory" : ""}
                  >
                    <option value="" disabled>Select type</option>
                    {options.opportunityForUs3Options?.map((o, i) => <option key={i} value={o}>{o}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="exactVersion">Exact Version:</label>
                  <select
                    name="exactVersion"
                    id="exactVersion"
                    value={formData.itLandscape.SAPInstalledBase?.exactVersion || ""}
                    onChange={(e) => handleChange(e, "itLandscape", "SAPInstalledBase")}
                    className={errors.exactVersion ? "mandatory" : ""}
                  >
                    <option value="" disabled>Select</option>
                    {options.versionOptions?.map((o, i) => <option key={i} value={o}>{o}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="hardware">Hardware:</label>
                  <input
                    type="text"
                    id="hardware"
                    name="hardware"
                    value={formData.itLandscape.SAPInstalledBase?.hardware || ""}
                    onChange={(e) => handleChange(e, "itLandscape", "SAPInstalledBase")}
                    className={errors.hardware ? "mandatory" : ""}
                  />
                </div>
              </FormRow>

              {/* Row 4: No. of License | License Value */}
              <FormRow>
                <div className="form-group">
                  <label htmlFor="noOfLicense">No. of License:</label>
                  <input
                    type="number"
                    id="noOfLicense"
                    name="noOfLicense"
                    value={formData.itLandscape.SAPInstalledBase?.noOfLicense || ""}
                    onChange={(e) => handleChange(e, "itLandscape", "SAPInstalledBase")}
                    className={errors.noOfLicense ? "mandatory" : ""}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="licenseValue">License Value:</label>
                  <input
                    type="text"
                    id="licenseValue"
                    name="licenseValue"
                    value={formData.itLandscape.SAPInstalledBase?.licenseValue || ""}
                    onChange={(e) => handleChange(e, "itLandscape", "SAPInstalledBase")}
                    className={errors.licenseValue ? "mandatory" : ""}
                  />
                </div>
              </FormRow>

              {/* Row 5: Modules Implemented | Implementation Partner | Total Project Cost */}
              <FormRow>
                <div className="form-group">
                  <label htmlFor="modulesImplemented">Modules Implemented:</label>
                  <input
                    type="text"
                    id="modulesImplemented"
                    name="modulesImplemented"
                    value={formData.itLandscape.SAPInstalledBase?.modulesImplemented || ""}
                    onChange={(e) => handleChange(e, "itLandscape", "SAPInstalledBase")}
                    className={errors.modulesImplemented ? "mandatory" : ""}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="implementationPartner">Implementation Partner:</label>
                  <input
                    type="text"
                    id="implementationPartner"
                    name="implementationPartner"
                    value={formData.itLandscape.SAPInstalledBase?.implementationPartner || ""}
                    onChange={(e) => handleChange(e, "itLandscape", "SAPInstalledBase")}
                    className={errors.implementationPartner ? "mandatory" : ""}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="totalProjectCost">Total Project Cost:</label>
                  <input
                    type="text"
                    id="totalProjectCost"
                    name="totalProjectCost"
                    value={formData.itLandscape.SAPInstalledBase?.totalProjectCost || ""}
                    onChange={(e) => handleChange(e, "itLandscape", "SAPInstalledBase")}
                    className={errors.totalProjectCost ? "mandatory" : ""}
                  />
                </div>
              </FormRow>
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
