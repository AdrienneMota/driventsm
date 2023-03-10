import { request } from "@/utils/request";
import { invalidCepError, notFoundError, requestError } from "@/errors";
import addressRepository, { CreateAddressParams } from "@/repositories/address-repository";
import enrollmentRepository, { CreateEnrollmentParams } from "@/repositories/enrollment-repository";
import { exclude } from "@/utils/prisma-utils";
import { Address, Enrollment } from "@prisma/client";
import { ViaCEPAddressResponse, ViaCEPAddress } from "@/protocols";

type ViaCEPAddressError = {
  erro: boolean
}

async function getAddressFromCEP(cep: string): Promise<ViaCEPAddressResponse | ViaCEPAddressError> {
  const result  = await request.get(`https://viacep.com.br/ws/${cep}/json/`);

  if (!result.data) {
    throw notFoundError();
  }

  const response = result.data as ViaCEPAddressError;
  if(response.erro) {
    return response;
  }

  const location = result.data as ViaCEPAddress;

  return {
    logradouro: location.logradouro,
    complemento: location.complemento,
    bairro: location.bairro,
    cidade: location.localidade,
    uf: location.uf,
  };
}

async function getOneWithAddressByUserId(userId: number): Promise<GetOneWithAddressByUserIdResult> {
  const enrollmentWithAddress = await enrollmentRepository.findWithAddressByUserId(userId);

  if (!enrollmentWithAddress) throw notFoundError();

  const [firstAddress] = enrollmentWithAddress.Address;
  const address = getFirstAddress(firstAddress);

  return {
    ...exclude(enrollmentWithAddress, "userId", "createdAt", "updatedAt", "Address"),
    ...(!!address && { address }),
  };
}

type GetOneWithAddressByUserIdResult = Omit<Enrollment, "userId" | "createdAt" | "updatedAt">;

function getFirstAddress(firstAddress: Address): GetAddressResult {
  if (!firstAddress) return null;

  return exclude(firstAddress, "createdAt", "updatedAt", "enrollmentId");
}

type GetAddressResult = Omit<Address, "createdAt" | "updatedAt" | "enrollmentId">;

async function createOrUpdateEnrollmentWithAddress(params: CreateOrUpdateEnrollmentWithAddress) {
  const enrollment = exclude(params, "address");
  const address = getAddressForUpsert(params.address);

  //TO DO - Verificar se o CEP ?? v??lido
  const validateCep = await getAddressFromCEP(address.cep) as ViaCEPAddressError;
  if(validateCep.erro) {
    throw invalidCepError();
  }

  const newEnrollment = await enrollmentRepository.upsert(params.userId, enrollment, exclude(enrollment, "userId"));

  await addressRepository.upsert(newEnrollment.id, address, address);
}

function getAddressForUpsert(address: CreateAddressParams) {
  return {
    ...address,
    ...(address?.addressDetail && { addressDetail: address.addressDetail }),
  };
}

export type CreateOrUpdateEnrollmentWithAddress = CreateEnrollmentParams & {
  address: CreateAddressParams;
};

const enrollmentsService = {
  getOneWithAddressByUserId,
  createOrUpdateEnrollmentWithAddress,
  getAddressFromCEP
};

export default enrollmentsService;
