/** @module api */
import Auth from './auth.js';

/**
 * Fetches a url using a stored access token, signing the user in
 * if no access token exists
 * @param {RequestInfo} input The request info to fetch
 * @param {RequestInit=} init The request init object
 * @return {Promise<Response>} Fetch response object
 */
const authenticatedFetch = async (input, init) => {
  const accessToken = Auth.getAccessToken();
  if (accessToken) {
    if (init) {
      // Add authorization headers to given init object
      if (init.headers) {
        init.headers['Authorization'] = `Bearer ${accessToken}`;
      } else {
        init.headers = {
          'Authorization': `Bearer ${accessToken}`,
        };
      }
    } else {
      // Initialize init object if none was given
      init = {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      };
    }

    const response = await fetch(input, init);

    if (!response.ok) {
      if (response.status == 401) {
        Auth.signIn();
      } else {
        throw new Error(await response.text());
      }
    }

    return response;
  } else {
    Auth.signIn();
  }
};

// TODO: Add ability to filter by search query, to
//       later implement with navigation views
// https://github.com/GoogleCloudPlatform/healthcare-api-dicom-viewer/issues/6
/**
 * Fetches one page of user's google cloud project ids
 * @param {string=} searchQuery Optional search query to filter project ids
 * @return {Promise<Array<string>>} List of project ids available to the user
 */
const fetchProjects = async (searchQuery) => {
  const request = {};
  if (searchQuery) {
    request.filter = `id:${searchQuery}*`;
  }
  const data = await gapi.client.cloudresourcemanager.projects.list(request);

  return data.result.projects.map((project) => project.projectId);
};

/**
 * Fetches a list of the possible location ids for a given project
 * @param {string} projectId Project id to search locations for
 * @return {Promise<Array<string>>} List of locations available for project
 */
const fetchLocations = async (projectId) => {
  const data = await gapi.client.healthcare.projects.locations.list({
    name: `projects/${projectId}`,
  });

  // Return a list of location Id's
  return data.result.locations.map((location) => location.locationId);
};

/**
 * Fetches a list of the datasets in a project location
 * @param {string} projectId Project id
 * @param {string} location Location
 * @return {Promise<Array<string>>} List of datasets available
 */
const fetchDatasets = async (projectId, location) => {
  // We currently don't support listing >100
  // datasets as this is a rare edge case
  const data = await gapi.client.healthcare.projects.locations.datasets.list({
    parent: `projects/${projectId}/locations/${location}`,
  });

  // Return a list of datasets by only using content of string after last '/'
  return data.result.datasets
      .map((dataset) => dataset.name.split('/').slice(-1)[0]);
};

/**
 * Fetches a list of the dicomStores in a dataset
 * @param {string} projectId Project ID
 * @param {string} location Location
 * @param {string} dataset Dataset
 * @return {Promise<Array<string>>} List of dicomStores available
 */
const fetchDicomStores = async (projectId, location, dataset) => {
  // We currently don't support listing >100
  // dicom stores as this is a rare edge case
  const data = await gapi.client.healthcare.projects.locations.datasets
      .dicomStores.list({
        parent: `projects/${projectId}/locations/${location}/` +
          `datasets/${dataset}`,
      });

  // Return a list of dicomStores by only using content of string after last '/'
  return data.result.dicomStores.map((dicomStore) =>
    dicomStore.name.split('/').slice(-1)[0]);
};

/**
 * Fetches a list of studies in a dicom store
 * @param {string} projectId Project ID
 * @param {string} location Location
 * @param {string} dataset Dataset
 * @param {string} dicomStore Dicom Store
 * @return {Promise<Array<Object>>} List of studies in the dicom store
 */
const fetchStudies =
    async (projectId, location, dataset, dicomStore) => {
  const data = await gapi.client.healthcare.projects.locations.datasets
      .dicomStores.searchForStudies({
        parent: `projects/${projectId}/locations/${location}/` +
    `datasets/${dataset}/dicomStores/${dicomStore}`,
        dicomWebPath: 'studies',
      });

  return data.result;
};

/**
 * Fetches a list of series in a study
 * @param {string} projectId Project ID
 * @param {string} location Location
 * @param {string} dataset Dataset
 * @param {string} dicomStore Dicom Store
 * @param {string} studyId Study UID
 * @return {Promise<Array<Object>>} List of series in the study
 */
const fetchSeries =
    async (projectId, location, dataset, dicomStore, studyId) => {
  const data = await gapi.client.healthcare.projects.locations.datasets
      .dicomStores.studies.searchForSeries({
        parent: `projects/${projectId}/locations/${location}/` +
    `datasets/${dataset}/dicomStores/${dicomStore}`,
        dicomWebPath: `studies/${studyId}/series`,
      });

  return data.result;
};

/**
 * Fetches a list of instances in a given
 *    project/location/dataset/dicomStore/study/series
 * @param {string} projectId Project ID
 * @param {string} location Location
 * @param {string} dataset Dataset
 * @param {string} dicomStore Dicom Store
 * @param {string} studyId Study UID
 * @param {string} seriesId Series UID
 * @return {Promise<Object[]>} List of instances in the series
 */
const fetchInstances =
    async (projectId, location, dataset, dicomStore, studyId, seriesId) => {
  const data = await gapi.client.healthcare.projects.locations.datasets
    .dicomStores.studies.searchForInstances({
      parent: `projects/${projectId}/locations/${location}/` +
      `datasets/${dataset}/dicomStores/${dicomStore}`,
      dicomWebPath: `studies/${studyId}/instances`,
    });

  return data.result;
};

/**
 * Fetches a dicom file from a given url using Google Authentication
 * @param {string} url Url for the dicom file
 * @return {Uint8Array} Byte array of DICOM P10 contents
 */
const fetchDicomFile = async (url) => {
  const response = await authenticatedFetch(url, {
    headers: {
      'Accept': 'application/dicom; transfer-syntax=*',
    },
  });

  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
};

/**
 * @typedef {Object} CancelablePromise
 * @property {Promise} promise The promise object
 * @property {function(): undefined} cancel Function to cancel the promise
 */

/**
 * Turns a promise into a cancelable promise to avoid
 * setting state after component unmounts
 * @param {Promise} promise Promise to make cancelable
 * @return {CancelablePromise} The cancelable promise
 */
const makeCancelable = (promise) => {
  let hasCanceled_ = false;

  const wrappedPromise = new Promise((resolve, reject) => {
    promise.then(
        // eslint-disable-next-line prefer-promise-reject-errors
        (val) => hasCanceled_ ? reject({isCanceled: true}) : resolve(val),
        // eslint-disable-next-line prefer-promise-reject-errors
        (error) => hasCanceled_ ? reject({isCanceled: true}) : reject(error),
    );
  });

  return {
    promise: wrappedPromise,
    cancel() {
      hasCanceled_ = true;
    },
  };
};

export {authenticatedFetch, fetchProjects, fetchLocations, fetchDatasets,
  fetchDicomStores, fetchStudies, fetchSeries, fetchInstances, fetchDicomFile,
  makeCancelable};
